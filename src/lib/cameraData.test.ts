import { describe, expect, it, vi } from 'vitest';
import { CameraRepository, coverageContains, tileKeysAlong } from './cameraData';
import { FLOCK, ALPR } from './cameras';
import { buildRouteLine } from './routeLine';
import { memoryCache } from './tileCache';
import { straightLine } from '../test/fixtures';

const coverage = [{ hole: false, points: [[-90, 30], [-80, 30], [-80, 40], [-90, 40]] as Array<[number, number]> }];
const index = { version: 1, dataTimestamp: '2026-09-23T00:00:00Z', tileSize: 0.5, count: 2, tiles: ['67_-169'], coverage };
const tile = [
  [101, 33.7501, -84.385, { man_made: 'surveillance', 'surveillance:type': 'ALPR', manufacturer: 'Flock Safety' }],
  [102, 33.76, -84.39, { man_made: 'surveillance', 'surveillance:type': 'camera' }]
];

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('CameraRepository', () => {
  it('loads Raven tiles along a route and keeps only tracked cameras', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('osm/index.json')) return jsonResponse(index);
      if (url.endsWith('osm/tiles/67_-169.json')) return jsonResponse(tile);
      return jsonResponse({}, 404);
    });
    const repository = new CameraRepository({ apiBase: 'https://example.test/api/v1/', fetchImpl: fetchImpl as typeof fetch, cache: memoryCache() });
    const line = buildRouteLine(straightLine());
    const report = await repository.ensureLine(line, 35);
    expect(report.complete).toBe(true);
    expect(repository.index.size).toBe(1);
    expect(repository.index.alongLine(line, 35, FLOCK | ALPR).map(hit => hit.camera.id)).toEqual([101]);
    await repository.ensureLine(line, 35);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // index + one tile, nothing refetched
  });

  it('serves cached tiles when offline', async () => {
    const cache = memoryCache();
    const online = vi.fn(async (input: RequestInfo | URL) => jsonResponse(String(input).endsWith('index.json') ? index : tile));
    await new CameraRepository({ fetchImpl: online as typeof fetch, cache }).ensureLine(buildRouteLine(straightLine()), 35);
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const repository = new CameraRepository({ fetchImpl: offline as typeof fetch, cache });
    const report = await repository.ensureLine(buildRouteLine(straightLine()), 35);
    expect(report.complete).toBe(true);
    expect(repository.index.size).toBe(1);
  });

  it('queries Overpass outside Raven’s coverage', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('osm/index.json')) return jsonResponse(index);
      if (url.includes('interpreter')) {
        return jsonResponse({ elements: [{ type: 'node', id: 7, lat: 51.5, lon: -0.1, tags: { man_made: 'surveillance', 'surveillance:type': 'ANPR' } }] });
      }
      return jsonResponse({}, 404);
    });
    const repository = new CameraRepository({ fetchImpl: fetchImpl as typeof fetch, cache: memoryCache(), overpassEndpoints: ['https://overpass.test/api/interpreter'] });
    const line = buildRouteLine([[-0.11, 51.5], [-0.09, 51.5]]);
    const report = await repository.ensureLine(line, 35);
    expect(report.complete).toBe(true);
    expect(repository.index.alongLine(line, 35, ALPR).map(hit => hit.camera.id)).toEqual([7]);
    expect(String(fetchImpl.mock.calls.at(-1)?.[0])).toContain('overpass.test');
  });

  it('reports incomplete data when tiles cannot be loaded', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => (String(input).endsWith('index.json') ? jsonResponse(index) : jsonResponse({}, 503)));
    const repository = new CameraRepository({ fetchImpl: fetchImpl as typeof fetch, cache: memoryCache() });
    const report = await repository.ensureLine(buildRouteLine(straightLine()), 35);
    expect(report).toEqual({ complete: false, failedAreas: 1 });
  });
});

describe('coverage helpers', () => {
  it('tests points against coverage rings', () => {
    expect(coverageContains(coverage, -84.39, 33.75)).toBe(true);
    expect(coverageContains(coverage, -0.1, 51.5)).toBe(false);
  });

  it('includes neighbouring tiles when the route runs along a tile edge', () => {
    const keys = tileKeysAlong(buildRouteLine([[-84.4, 33.9999], [-84.3, 33.9999]]), 0.5, 100);
    expect([...keys].sort()).toEqual(['67_-169', '68_-169']);
  });
});
