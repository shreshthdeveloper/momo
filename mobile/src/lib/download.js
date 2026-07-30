import { useCallback, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { BASE_URL, getAccessToken, ApiError } from './api.js';

/**
 * Fetch a file the API generates and hand it to the OS share sheet.
 *
 * ── Why this is not `api.get` ────────────────────────────────────────────────
 *
 * `request()` in api.js parses every response as JSON and returns `json.data`. A
 * CSV route returns `text/csv`, so going through it throws on the first comma.
 * This speaks the same auth but reads text.
 *
 * ── Why the share sheet rather than a save ───────────────────────────────────
 *
 * The four export routes have existed since F8.6.6 and nothing in the app ever
 * called one, so a teacher's only route to a spreadsheet was to read numbers off
 * a phone screen and retype them. What they actually want to do with a roster is
 * *send it* — to themselves, to a colleague, into Drive — and the share sheet is
 * every one of those destinations without the app having to know about any of
 * them. Writing to a private cache directory and announcing a file path would be
 * technically a download and practically useless.
 *
 * The cache directory is deliberate: this is a copy of server-side state, not
 * user data. The OS may reclaim it whenever it likes and nothing is lost.
 */
export async function downloadAndShare(
  path,
  {
    query,
    filename,
    mimeType = 'text/csv',
    /**
     * Present for the import-error report, which is a POST: the rows it describes
     * live in the validation report the client is holding, not in the database, so
     * there is nothing for a GET to name. Sending a body switches the method.
     */
    body,
  } = {},
) {
  const url = new URL(`${BASE_URL}/api/v1${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const token = getAccessToken();
  let res;
  try {
    res = await fetch(url.toString(), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        accept: `${mimeType}, application/json`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Lost connection. Reconnecting.');
  }

  const csv = await res.text();

  if (!res.ok) {
    /**
     * An error from these routes is JSON even though the request asked for CSV,
     * so the failure path has to parse what it actually got. Without this the
     * user's error message is the raw body of a 403.
     */
    let parsed = {};
    try {
      parsed = JSON.parse(csv);
    } catch {
      parsed = {};
    }
    const err = parsed.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? 'EXPORT_FAILED',
      err.message ?? 'That export could not be generated.',
    );
  }

  /**
   * An export with a header row and nothing under it is a real answer — nobody in
   * the batch has played yet — but handing over an empty spreadsheet looks like a
   * broken button. Said plainly instead.
   */
  const lines = csv.trim().split('\n');
  if (lines.length <= 1) {
    throw new ApiError(200, 'EXPORT_EMPTY', 'There is nothing to export yet.');
  }

  const target = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(target, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (!(await Sharing.isAvailableAsync())) {
    throw new ApiError(
      0,
      'SHARING_UNAVAILABLE',
      'This device cannot share files. Open the console on a computer to export.',
    );
  }

  await Sharing.shareAsync(target, {
    mimeType,
    // Android reads `dialogTitle`; iOS ignores it. Naming the file in the sheet
    // is the only confirmation the user gets that the right thing was built.
    dialogTitle: filename,
    UTI: 'public.comma-separated-values-text',
  });

  return { rows: lines.length - 1 };
}

/**
 * A filename a person can find again in their downloads.
 *
 * `students.csv` — which is what the server's own `content-disposition` says — is
 * indistinguishable from the last three exports the moment there is more than one
 * organization or more than one contest. The share sheet shows this name, so it is
 * the only label the file ever gets.
 */
export function csvName(...parts) {
  const slug = parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'export'}.csv`;
}

/**
 * The export button's state, so four screens do not each grow their own.
 *
 * Returns `{ exporting, error, run, dismiss }`. `run` takes the same arguments as
 * `downloadAndShare` and swallows nothing: a failed export puts a message on the
 * screen through the caller's existing `ErrorNotice`, because the one thing worse
 * than a button that does not work is a button that appears to.
 *
 * `exporting` guards a second press. Generating a roster is a real query and the
 * share sheet takes a moment to appear, which is exactly the gap in which someone
 * presses again.
 */
export function useExport() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(
    async (path, options) => {
      if (exporting) return null;
      setExporting(true);
      setError(null);
      try {
        return await downloadAndShare(path, options);
      } catch (err) {
        setError(err);
        return null;
      } finally {
        setExporting(false);
      }
    },
    [exporting],
  );

  return { exporting, error, run, dismiss: useCallback(() => setError(null), []) };
}
