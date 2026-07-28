import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// NODE_ENV arrives from the shell, so it is already known before dotenv runs.
// Production reads .env.production and nothing else — no falling back to .env,
// because a production box quietly booting on development values is the exact
// failure assertProductionConfig exists to prevent.
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(here, `../../${envFile}`), quiet: true });

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1' || v === 'yes';
};
const int = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

export const env = {
  NODE_ENV,
  isProd,
  isTest,
  isDev: !isProd && !isTest,

  PORT: int(process.env.PORT, 4000),
  HOST: process.env.HOST ?? '0.0.0.0',
  /** Absolute origin the API is reachable at, used to build upload URLs. */
  PUBLIC_URL: process.env.PUBLIC_URL ?? `http://localhost:${int(process.env.PORT, 4000)}`,

  MONGO_URL:
    (isTest ? process.env.MONGO_URL_TEST : process.env.MONGO_URL) ??
    (isTest
      ? 'mongodb://127.0.0.1:27017/mimo_test'
      : 'mongodb://127.0.0.1:27017/mimo'),

  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-change-me-in-production',
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL ?? '15m',
  REFRESH_TOKEN_TTL_DAYS: int(process.env.REFRESH_TOKEN_TTL_DAYS, 60),

  /** Comma-separated origins for the Expo dev server and any web build. */
  CORS_ORIGINS: (process.env.CORS_ORIGINS ?? 'http://localhost:8081')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /**
   * SMS provider. `console` prints the OTP to the server log instead of
   * sending it — the only sane option in development, and it is refused
   * outright in production so a misconfigured deploy cannot silently accept
   * any code.
   */
  SMS_PROVIDER: process.env.SMS_PROVIDER ?? 'console',
  SMS_API_KEY: process.env.SMS_API_KEY ?? '',
  SMS_SENDER_ID: process.env.SMS_SENDER_ID ?? 'TEZAPP',

  /**
   * Development shortcut: this OTP is accepted for any number. Ignored
   * entirely outside development.
   */
  DEV_MASTER_OTP: process.env.DEV_MASTER_OTP ?? '000000',

  STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local', // local | s3 | minio
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR ?? 'uploads',
  S3_BUCKET: process.env.S3_BUCKET ?? '',
  S3_REGION: process.env.S3_REGION ?? 'ap-south-1',
  S3_PUBLIC_BASE: process.env.S3_PUBLIC_BASE ?? '',

  /** MinIO — S3-compatible object storage for covers, avatars and uploads. */
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT ?? '',
  MINIO_PORT: Number(process.env.MINIO_PORT ?? 443),
  MINIO_USE_SSL: (process.env.MINIO_USE_SSL ?? 'true') === 'true',
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY ?? '',
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY ?? '',
  MINIO_BUCKET: process.env.MINIO_BUCKET ?? 'mimo',
  /** Public base for stored objects; defaults to the endpoint + bucket. */
  MINIO_PUBLIC_BASE: process.env.MINIO_PUBLIC_BASE ?? '',

  FCM_SERVER_KEY: process.env.FCM_SERVER_KEY ?? '',

  /**
   * prd.md F8.2.6 — AI-assisted drafting. Optional: without a key the endpoint
   * refuses with a message naming the missing setting, rather than inventing
   * questions. Every draft lands in the review queue regardless; nothing this
   * produces can reach a player without a human pressing publish.
   */
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  AI_MODEL: process.env.AI_MODEL ?? 'claude-sonnet-5',
  AI_MAX_DRAFTS_PER_REQUEST: int(process.env.AI_MAX_DRAFTS_PER_REQUEST, 20),

  /**
   * Ghost opponents (prd.md §6.7). On in production, where an empty lobby is
   * the worse failure — but a bot the player is never told about also makes
   * "did two real devices actually pair?" an unanswerable question, which is
   * exactly what you need to answer before a launch. Turning this off makes the
   * queue human-only: it keeps searching until a real opponent arrives or the
   * player cancels, so a match found is proof of a match made.
   *
   * Refused in production by assertProductionConfig — F6.4.3 promises nobody
   * waits forever, and only a ghost can keep that promise.
   */
  GHOSTS_ENABLED: bool(process.env.GHOSTS_ENABLED, true),
  /**
   * How long the queue looks for a live opponent before serving a ghost. The
   * shipped default is constants.GHOST_AFTER_MS; this override exists so a
   * two-device test can widen the window without a rebuild.
   */
  GHOST_AFTER_MS: int(process.env.GHOST_AFTER_MS, undefined),

  /** Background jobs off by default in test so timers don't leak into runs. */
  ENABLE_JOBS: bool(process.env.ENABLE_JOBS, !isTest),
  LOG_LEVEL: process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),

  SUPERADMIN_PHONES: (process.env.SUPERADMIN_PHONES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

/**
 * Fails fast rather than booting a production process with development
 * defaults. A JWT secret of "dev-only-change-me" in production is not a
 * config problem, it is a breach waiting to be found.
 */
export function assertProductionConfig() {
  if (!env.isProd) return;
  const problems = [];
  if (env.JWT_SECRET === 'dev-only-change-me-in-production' || env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET must be set to a random value of at least 32 characters');
  }
  if (env.SMS_PROVIDER === 'console') {
    problems.push('SMS_PROVIDER must be a real provider in production');
  }
  if (!process.env.MONGO_URL) {
    problems.push('MONGO_URL must be set explicitly');
  }
  if (!env.GHOSTS_ENABLED) {
    problems.push('GHOSTS_ENABLED must be on — it is a development testing switch, and with it off prd.md F6.4.3 cannot be kept');
  }
  if (problems.length) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}
