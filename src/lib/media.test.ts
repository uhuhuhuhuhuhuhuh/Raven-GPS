import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONNECTORS } from './media';

describe('media connectors', () => {
  it('includes Spotify and Plex (Plexamp and the Plex app)', () => {
    expect(CONNECTORS.map(connector => connector.id)).toEqual(expect.arrayContaining(['spotify', 'plexamp', 'plex']));
  });

  it('declares every connector app in the Android manifest, so it can be detected and opened', () => {
    const manifest = readFileSync(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    const declared = [...manifest.matchAll(/<package android:name="([^"]+)"/g)].map(match => match[1]);
    expect(declared.sort()).toEqual(CONNECTORS.map(connector => connector.package).sort());
  });
});
