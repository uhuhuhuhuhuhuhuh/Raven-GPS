import { ALPR, ENFORCEMENT, FLOCK } from './cameras';
import { readJson, writeJson } from './storage';
import { DEFAULT_ROUTING_ENDPOINT, type RoutePreferences, type Units } from './valhalla';

export type Settings = {
  /** Route around cameras; when off they are still shown and announced. */
  avoidCameras: boolean;
  avoidFlock: boolean;
  avoidPlateReaders: boolean;
  avoidEnforcement: boolean;
  /** Meters: passing a camera closer than this counts. */
  radius: number;
  cameraAlerts: boolean;
  showCameras: boolean;
  voice: boolean;
  units: Units;
  avoidTolls: boolean;
  avoidFerries: boolean;
  avoidHighways: boolean;
  routingEndpoint: string;
  /** Preferred music/audio app (Android package name). */
  mediaApp: string | null;
};

const KEY = 'raven-gps:settings';

export function defaultUnits(language = typeof navigator === 'undefined' ? 'en-US' : navigator.language): Units {
  return /^en-(US|LR|MM)$|^my/i.test(language) || language === 'en' ? 'mi' : 'km';
}

export const DEFAULT_SETTINGS: Settings = {
  avoidCameras: true,
  avoidFlock: true,
  avoidPlateReaders: true,
  avoidEnforcement: false,
  radius: 35,
  cameraAlerts: true,
  showCameras: true,
  voice: true,
  units: defaultUnits(),
  avoidTolls: false,
  avoidFerries: false,
  avoidHighways: false,
  routingEndpoint: DEFAULT_ROUTING_ENDPOINT,
  mediaApp: null
};

export function loadSettings(): Settings {
  const stored = readJson<Partial<Settings>>(KEY, {});
  return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

export function saveSettings(settings: Settings): void {
  writeJson(KEY, settings);
}

/** Camera kinds (bit flags) the user cares about: avoided, or at least announced. */
export function cameraMask(settings: Settings): number {
  return (settings.avoidFlock ? FLOCK : 0) | (settings.avoidPlateReaders ? ALPR : 0) | (settings.avoidEnforcement ? ENFORCEMENT : 0);
}

export function routePreferences(settings: Settings): RoutePreferences {
  const language = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US';
  return { avoidTolls: settings.avoidTolls, avoidFerries: settings.avoidFerries, avoidHighways: settings.avoidHighways, units: settings.units, language };
}

/** What the user is avoiding, in words: "Flock devices and all plate readers". */
export function avoidSummary(settings: Settings): string {
  const parts: string[] = [];
  if (settings.avoidFlock && settings.avoidPlateReaders) parts.push('Flock devices and all plate readers');
  else if (settings.avoidPlateReaders) parts.push('all plate readers');
  else if (settings.avoidFlock) parts.push('Flock devices');
  if (settings.avoidEnforcement) parts.push('speed cameras');
  return parts.join(', ') || 'nothing';
}
