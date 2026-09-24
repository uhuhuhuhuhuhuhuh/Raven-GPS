import { describe, expect, it } from 'vitest';
import { checkForUpdate, parseVersionCode, parseVersionName } from './update';

const notes = 'Build 1.0.42 from abc1234. Download raven-gps.apk on your Android phone.';

function releaseResponse(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

describe('update notes parsing', () => {
  it('reads the versionCode and versionName from the release notes', () => {
    expect(parseVersionCode(notes)).toBe(42);
    expect(parseVersionName(notes)).toBe('1.0.42');
  });
  it('returns null on missing or malformed notes', () => {
    expect(parseVersionCode(undefined)).toBeNull();
    expect(parseVersionCode('no build here')).toBeNull();
    expect(parseVersionName(null)).toBeNull();
  });
});

describe('checkForUpdate', () => {
  const release = { body: notes, assets: [{ name: 'raven-gps.apk', browser_download_url: 'https://example.com/raven-gps.apk' }] };

  it('flags an update when the release is newer than the installed build', async () => {
    const info = await checkForUpdate(41, releaseResponse(release));
    expect(info.available).toBe(true);
    expect(info.versionCode).toBe(42);
    expect(info.apkUrl).toBe('https://example.com/raven-gps.apk');
  });

  it('reports no update when already on the latest build', async () => {
    expect((await checkForUpdate(42, releaseResponse(release))).available).toBe(false);
    expect((await checkForUpdate(99, releaseResponse(release))).available).toBe(false);
  });

  it('does not flag an update when the release has no apk asset', async () => {
    const info = await checkForUpdate(1, releaseResponse({ body: notes, assets: [] }));
    expect(info.available).toBe(false);
  });

  it('fails safe (no update) on a network or API error', async () => {
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await checkForUpdate(1, boom)).available).toBe(false);
    expect((await checkForUpdate(1, releaseResponse(release, false))).available).toBe(false);
  });
});
