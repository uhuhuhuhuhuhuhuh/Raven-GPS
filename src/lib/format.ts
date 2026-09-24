import type { Units } from './valhalla';

const FEET_PER_METER = 3.28084;
const METERS_PER_MILE = 1609.344;

/** Display distance: "450 ft" / "0.3 mi" / "12 mi", or "80 m" / "1.2 km". */
export function formatDistance(meters: number, units: Units): { value: string; unit: string } {
  if (units === 'mi') {
    const miles = meters / METERS_PER_MILE;
    if (miles < 0.1) return { value: String(Math.max(0, Math.round((meters * FEET_PER_METER) / 50) * 50)), unit: 'ft' };
    return { value: miles < 10 ? miles.toFixed(1) : String(Math.round(miles)), unit: 'mi' };
  }
  if (meters < 1000) return { value: String(Math.max(0, Math.round(meters / 10) * 10)), unit: 'm' };
  const km = meters / 1000;
  return { value: km < 10 ? km.toFixed(1) : String(Math.round(km)), unit: 'km' };
}

export function distanceText(meters: number, units: Units): string {
  const { value, unit } = formatDistance(meters, units);
  return `${value} ${unit}`;
}

/** Spoken distance: "500 feet", "a quarter mile", "2 miles", "300 meters". */
export function spokenDistance(meters: number, units: Units): string {
  if (units === 'mi') {
    const miles = meters / METERS_PER_MILE;
    if (miles < 0.19) {
      const feet = Math.max(100, Math.round((meters * FEET_PER_METER) / 100) * 100);
      return `${feet} feet`;
    }
    if (miles < 0.375) return 'a quarter mile';
    if (miles < 0.625) return 'half a mile';
    if (miles < 0.875) return 'three quarters of a mile';
    const rounded = miles < 3 ? Math.round(miles * 2) / 2 : Math.round(miles);
    return rounded === 1 ? '1 mile' : `${rounded} miles`;
  }
  if (meters < 950) return `${Math.max(50, Math.round(meters / 50) * 50)} meters`;
  const km = meters < 3000 ? Math.round(meters / 500) / 2 : Math.round(meters / 1000);
  return km === 1 ? '1 kilometer' : `${km} kilometers`;
}

/** "5 min", "1 h 20 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function speedValue(metersPerSecond: number | null | undefined, units: Units): number | null {
  if (metersPerSecond === null || metersPerSecond === undefined || !Number.isFinite(metersPerSecond) || metersPerSecond < 0) return null;
  return Math.round(units === 'mi' ? metersPerSecond * 2.23694 : metersPerSecond * 3.6);
}
