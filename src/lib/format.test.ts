import { describe, expect, it } from 'vitest';
import { distanceText, formatDuration, speedValue, spokenDistance } from './format';

describe('format', () => {
  it('formats display distances', () => {
    expect(distanceText(120, 'mi')).toBe('400 ft');
    expect(distanceText(1609.344 * 2.34, 'mi')).toBe('2.3 mi');
    expect(distanceText(640, 'km')).toBe('640 m');
    expect(distanceText(12_400, 'km')).toBe('12 km');
  });

  it('formats spoken distances the way people say them', () => {
    expect(spokenDistance(150, 'mi')).toBe('500 feet');
    expect(spokenDistance(400, 'mi')).toBe('a quarter mile');
    expect(spokenDistance(800, 'mi')).toBe('half a mile');
    expect(spokenDistance(1609, 'mi')).toBe('1 mile');
    expect(spokenDistance(4000, 'mi')).toBe('2.5 miles');
    expect(spokenDistance(420, 'km')).toBe('400 meters');
    expect(spokenDistance(1500, 'km')).toBe('1.5 kilometers');
  });

  it('formats durations and speeds', () => {
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
    expect(speedValue(13.4, 'mi')).toBe(30);
    expect(speedValue(null, 'km')).toBeNull();
  });
});
