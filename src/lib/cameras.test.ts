import { describe, expect, it } from 'vitest';
import { ALPR, CameraIndex, ENFORCEMENT, FLOCK, cameraFromNode, classify, parseDirections, type Camera } from './cameras';
import { buildRouteLine } from './routeLine';
import { straightLine } from '../test/fixtures';

const camera = (id: number, lon: number, lat: number, kinds = FLOCK | ALPR): Camera => ({ id, lon, lat, kinds, directions: [], label: 'Flock Safety plate reader' });

describe('classify', () => {
  it('recognises Flock devices by name, brand, operator or Wikidata', () => {
    expect(classify({ man_made: 'surveillance', 'surveillance:type': 'ALPR', manufacturer: 'Flock Safety' })).toBe(FLOCK | ALPR);
    expect(classify({ man_made: 'surveillance', 'manufacturer:wikidata': 'Q108485435' })).toBe(FLOCK);
    expect(classify({ man_made: 'surveillance', brand: 'Flock' })).toBe(FLOCK);
    expect(classify({ man_made: 'surveillance', operator: 'Flock Safety' })).toBe(FLOCK);
    expect(classify({ man_made: 'surveillance', description: 'This is a gunshot detection device by Flock Safety' })).toBe(FLOCK);
  });

  it('does not match unrelated uses of the word', () => {
    expect(classify({ man_made: 'surveillance', description: 'A flock of pigeons lives on this camera' })).toBe(0);
    expect(classify({ man_made: 'surveillance', 'surveillance:type': 'camera' })).toBe(0);
  });

  it('recognises other vendors’ plate readers and enforcement cameras', () => {
    expect(classify({ man_made: 'surveillance', 'surveillance:type': 'ALPR', manufacturer: 'Motorola Solutions' })).toBe(ALPR);
    expect(classify({ man_made: 'surveillance', 'surveillance:type': 'anpr' })).toBe(ALPR);
    expect(classify({ highway: 'speed_camera' })).toBe(ENFORCEMENT);
  });

  it('describes cameras for alerts', () => {
    expect(cameraFromNode(1, 0, 0, { 'surveillance:type': 'ALPR', manufacturer: 'Flock Safety' })?.label).toBe('Flock Safety plate reader');
    expect(cameraFromNode(2, 0, 0, { manufacturer: 'Flock Safety', model: 'Flock Raven' })?.label).toBe('Flock Safety gunshot detector');
    expect(cameraFromNode(3, 0, 0, { 'surveillance:type': 'ALPR', manufacturer: 'Vigilant' })?.label).toBe('Plate reader (Vigilant)');
    expect(cameraFromNode(4, 0, 0, { 'surveillance:type': 'camera' })).toBeNull();
  });

  it('parses mapped viewing directions', () => {
    expect(parseDirections({ direction: '90;270' })).toEqual([90, 270]);
    expect(parseDirections({ 'camera:direction': 'NE' })).toEqual([45]);
    expect(parseDirections({ direction: '-90' })).toEqual([270]);
    expect(parseDirections({})).toEqual([]);
    expect(parseDirections({ direction: 'forward' })).toEqual([]);
  });
});

describe('CameraIndex', () => {
  it('finds cameras along a route in driving order, filtered by kind', () => {
    const index = new CameraIndex();
    index.add([
      camera(1, -84.385, 33.7501), // ~11 m off the road
      camera(2, -84.395, 33.7502), // ~22 m off, earlier on the route
      camera(3, -84.39, 33.752), // ~220 m away
      camera(4, -84.391, 33.75, ENFORCEMENT)
    ]);
    const line = buildRouteLine(straightLine());
    const hits = index.alongLine(line, 35, FLOCK | ALPR);
    expect(hits.map(hit => hit.camera.id)).toEqual([2, 1]);
    expect(hits[0].offset).toBeCloseTo(22, 0);
    expect(hits[0].point[1]).toBeCloseTo(33.75, 6);
    expect(index.alongLine(line, 35, ENFORCEMENT).map(hit => hit.camera.id)).toEqual([4]);
  });

  it('ignores cameras whose line of sight crosses the route', () => {
    const index = new CameraIndex();
    const facing = (id: number, direction: number): Camera => ({ ...camera(id, -84.39, 33.7501), directions: [direction] });
    // The route runs east–west; a camera looking north–south only sees the cross street.
    index.add([facing(1, 90), facing(2, 270), facing(3, 0), facing(4, 125), facing(5, 160)]);
    const hits = index.alongLine(buildRouteLine(straightLine()), 35, FLOCK | ALPR);
    expect(hits.map(hit => hit.camera.id).sort()).toEqual([1, 2, 4]);
  });

  it('replaces a camera re-added with new data', () => {
    const index = new CameraIndex();
    index.add([camera(1, -84.385, 33.75)]);
    index.add([camera(1, -84.3, 33.8)]);
    expect(index.size).toBe(1);
    expect(index.near([-84.385, 33.75], 100, FLOCK)).toEqual([]);
    expect(index.near([-84.3, 33.8], 10, FLOCK).map(item => item.id)).toEqual([1]);
  });
});
