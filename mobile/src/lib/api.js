import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * API client.
 *
 * tech.md §15 — tokens live in `expo-secure-store`, never AsyncStorage.
 * Refresh is single-flight: the server rotates refresh tokens and treats a
 * reused one as theft, so ten queries expiring together must produce one
 * refresh call, not ten.
 */

const KEY_ACCESS = 'mimo.accessToken';
const KEY_REFRESH = 'mimo.refreshToken';

/**
 * A physical Android device cannot reach the host's `localhost`. Expo exposes
 * the packager's host, which is the same machine running the API in
 * development, so we derive the API origin from it.
 */
function resolveBaseUrl() {
  const configured = Constants.expoConfig?.extra?.apiUrl;
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;

  if (hostUri && configured?.includes('localhost')) {
    const host = hostUri.split(':')[0];
    return `http://${host}:4000`;
  }
  if (configured) return configured;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

export const BASE_URL = resolveBaseUrl();
const API = `${BASE_URL}/api/v1`;

let accessToken = null;
let refreshToken = null;
let refreshInFlight = null;
let onUnauthenticated = () => {};

export function setUnauthenticatedHandler(fn) {
  onUnauthenticated = fn;
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── Token storage ──────────────────────────────────────────────────────────

export async function loadTokens() {
  try {
    const [a, r] = await Promise.all([
      SecureStore.getItemAsync(KEY_ACCESS),
      SecureStore.getItemAsync(KEY_REFRESH),
    ]);
    accessToken = a;
    refreshToken = r;
    return Boolean(a && r);
  } catch {
    return false;
  }
}

export async function saveTokens(tokens) {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS, tokens.accessToken),
    SecureStore.setItemAsync(KEY_REFRESH, tokens.refreshToken),
  ]);
}

export async function clearTokens() {
  accessToken = null;
  refreshToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {}),
  ]);
}

export function getAccessToken() {
  return accessToken;
}

// ── Requests ───────────────────────────────────────────────────────────────

async function doRefresh() {
  if (!refreshToken) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await clearTokens();
      onUnauthenticated();
      throw new ApiError(401, 'REFRESH_FAILED', 'Your session ended. Sign in again.');
    }
    const body = await res.json();
    await saveTokens(body.data.tokens);
    return body.data.tokens.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function request(path, options = {}) {
  const { method = 'GET', body, query, retryOn401 = true, timeoutMs = 15000 } = options;

  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers = { accept: 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // design.md §10 — "Lost connection. Reconnecting." Never "Oops!".
    if (err.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'That took too long. Check your connection.');
    }
    throw new ApiError(0, 'OFFLINE', 'Lost connection. Reconnecting.');
  }
  clearTimeout(timer);

  if (res.status === 401 && retryOn401 && refreshToken) {
    await doRefresh();
    return request(path, { ...options, retryOn401: false });
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const err = json.error ?? {};
    if (res.status === 401) onUnauthenticated();
    throw new ApiError(res.status, err.code ?? 'REQUEST_FAILED', err.message ?? 'That did not work.', err.details);
  }

  return json.data;
}

export const api = {
  get: (path, query) => request(path, { method: 'GET', query }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path, body) => request(path, { method: 'DELETE', body }),

  /**
   * Multipart image upload — `kind` is 'avatar' | 'banner' | 'cover' | …; the
   * local `uri` comes from the image picker. Returns `{ url }`. fetch is used
   * directly because `request()` speaks JSON, and FormData must set its own
   * content-type boundary.
   */
  upload: async (kind, uri, mimeType = 'image/jpeg') => {
    const form = new FormData();
    form.append('file', { uri, type: mimeType, name: `upload.${mimeType.split('/')[1] ?? 'jpg'}` });
    const res = await fetch(`${API}/uploads/${kind}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${getAccessToken()}` },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json?.error?.message ?? 'Upload failed.');
      err.code = json?.error?.code;
      throw err;
    }
    return json.data;
  },
};

// ── Auth ───────────────────────────────────────────────────────────────────

export const auth = {
  sendOtp: (phone) => request('/auth/otp/send', { method: 'POST', body: { phone }, retryOn401: false }),

  verifyOtp: async (phone, code) => {
    const data = await request('/auth/otp/verify', {
      method: 'POST',
      body: { phone, code },
      retryOn401: false,
    });
    await saveTokens(data.tokens);
    return data;
  },

  session: () => api.get('/auth/session'),

  logout: async () => {
    const token = refreshToken;
    await clearTokens();
    if (token) {
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      }).catch(() => {});
    }
  },
};
