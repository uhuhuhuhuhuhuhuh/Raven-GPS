/**
 * In-app update check. The Android build publishes raven-gps.apk to the GitHub "preview"
 * release on every push (see .github/workflows/android.yml). The release notes carry
 * "Build 1.0.<n> from <sha>", where <n> is the app's versionCode (the CI run number, which
 * only ever increases). Comparing that against the installed versionCode tells us whether a
 * newer build is out, without depending on the rolling "preview" tag name.
 */
const RELEASE_API = 'https://api.github.com/repos/uhuhuhuhuhuhuhuh/Raven-GPS/releases/tags/preview';
export const RELEASE_PAGE = 'https://github.com/uhuhuhuhuhuhuhuh/Raven-GPS/releases/tag/preview';

export type UpdateInfo = {
  available: boolean;
  /** Latest published version, e.g. "1.0.42". */
  versionName: string | null;
  /** Latest published versionCode. */
  versionCode: number | null;
  /** Direct download URL of the latest raven-gps.apk. */
  apkUrl: string | null;
  /** Human-readable release page, for the browser fallback. */
  page: string;
};

type Release = {
  body?: string;
  assets?: { name: string; browser_download_url: string }[];
};

/** "Build 1.0.42 from abc1234" -> 42 (the versionCode). */
export function parseVersionCode(notes: string | undefined | null): number | null {
  const match = notes?.match(/Build\s+\d+\.\d+\.(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** "Build 1.0.42 from abc1234" -> "1.0.42". */
export function parseVersionName(notes: string | undefined | null): string | null {
  const match = notes?.match(/Build\s+(\d+\.\d+\.\d+)/i);
  return match ? match[1] : null;
}

/** Checks the preview release for a build newer than `currentVersionCode`. Never throws. */
export async function checkForUpdate(currentVersionCode: number, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo> {
  const base: UpdateInfo = { available: false, versionName: null, versionCode: null, apkUrl: null, page: RELEASE_PAGE };
  try {
    const response = await fetchImpl(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return base;
    const release = (await response.json()) as Release;
    const versionCode = parseVersionCode(release.body);
    const versionName = parseVersionName(release.body);
    const apk = release.assets?.find(asset => asset.name.endsWith('.apk'));
    const available = versionCode !== null && versionCode > currentVersionCode && Boolean(apk);
    return { available, versionName, versionCode, apkUrl: apk?.browser_download_url ?? null, page: RELEASE_PAGE };
  } catch {
    return base;
  }
}
