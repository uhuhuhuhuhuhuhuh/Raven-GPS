import type { LonLat } from './geo';

/**
 * Place search via Photon (komoot's OpenStreetMap geocoder), which unlike Nominatim's
 * public server permits search-as-you-type.
 */
export const PHOTON_ENDPOINT = 'https://photon.komoot.io';

export type Place = {
  id: string;
  name: string;
  detail: string;
  lon: number;
  lat: number;
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    postcode?: string;
    osm_value?: string;
  };
};

export function placeFromFeature(feature: PhotonFeature): Place {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const address = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || address || p.city || p.county || p.state || 'Dropped pin';
  const locality = p.city || p.district || p.county;
  const detail = [address && address !== name ? address : '', locality && locality !== name ? locality : '', p.state && p.state !== name ? p.state : '', p.countrycode && p.countrycode !== 'US' ? p.country : '']
    .filter(Boolean)
    .join(', ');
  return { id: `${p.osm_type ?? 'X'}${p.osm_id ?? `${lat},${lon}`}`, name, detail, lon, lat };
}

/** "25.76, -80.19" (lat, lon) typed into the search box. */
export function parseCoordinates(text: string): LonLat | null {
  const match = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

function language(): string {
  const code = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return ['en', 'de', 'fr'].includes(code) ? code : 'en';
}

export async function searchPlaces(query: string, near: LonLat | null, signal?: AbortSignal, fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<Place[]> {
  const coordinates = parseCoordinates(query);
  if (coordinates) return [{ id: `coords:${coordinates.join(',')}`, name: `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`, detail: 'Coordinates', lon: coordinates[0], lat: coordinates[1] }];
  const params = new URLSearchParams({ q: query, limit: '8', lang: language() });
  if (near) {
    params.set('lon', near[0].toFixed(4));
    params.set('lat', near[1].toFixed(4));
  }
  const response = await fetchImpl(`${PHOTON_ENDPOINT}/api/?${params}`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Search failed (HTTP ${response.status})`);
  const payload = (await response.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  return (payload.features ?? []).map(placeFromFeature).filter(place => {
    const key = `${place.name}|${place.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function reversePlace(point: LonLat, signal?: AbortSignal, fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<Place> {
  const fallback: Place = { id: `pin:${point.join(',')}`, name: 'Dropped pin', detail: `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`, lon: point[0], lat: point[1] };
  try {
    const params = new URLSearchParams({ lon: String(point[0]), lat: String(point[1]), lang: language() });
    const response = await fetchImpl(`${PHOTON_ENDPOINT}/reverse?${params}`, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return fallback;
    const feature = ((await response.json()) as { features?: PhotonFeature[] }).features?.[0];
    return feature ? { ...placeFromFeature(feature), lon: point[0], lat: point[1] } : fallback;
  } catch {
    return fallback;
  }
}
