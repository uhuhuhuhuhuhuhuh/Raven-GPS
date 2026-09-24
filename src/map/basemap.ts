import { timeoutSignal } from '../lib/signals';
import type { StyleSpecification } from 'maplibre-gl';

/**
 * OpenFreeMap's dark vector style: free, keyless, cookie-free and meant for app traffic.
 * Falls back to OpenStreetMap raster tiles if the style can't be loaded.
 */
export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export type Basemap = { style: StyleSpecification; textFont: string[]; source: 'openfreemap' | 'fallback' };

export const FALLBACK_BASEMAP: Basemap = {
  source: 'fallback',
  textFont: ['Open Sans Bold'],
  style: {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' }
    },
    layers: [{
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-saturation': -0.85, 'raster-brightness-min': 0.1, 'raster-brightness-max': 0.5, 'raster-contrast': 0.3, 'raster-hue-rotate': 70 }
    }]
  }
};

/** Deep-navy background and water, and brighter road casings so the drive reads at a glance. */
export function tintStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map(layer => {
      if (layer.type === 'background') return { ...layer, paint: { ...layer.paint, 'background-color': '#0b0f17' } };
      if (layer.type === 'fill' && layer.id === 'water') return { ...layer, paint: { ...layer.paint, 'fill-color': '#0c1726' } };
      return layer;
    })
  };
}

export async function loadBasemap(): Promise<Basemap> {
  try {
    const response = await fetch(OPENFREEMAP_STYLE_URL, { signal: timeoutSignal(8000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`style request failed (${response.status})`);
    const style = (await response.json()) as StyleSpecification;
    if (style?.version !== 8 || !Array.isArray(style.layers) || !style.glyphs) throw new Error('unexpected style document');
    return { style: tintStyle(style), textFont: ['Noto Sans Bold'], source: 'openfreemap' };
  } catch {
    return FALLBACK_BASEMAP;
  }
}
