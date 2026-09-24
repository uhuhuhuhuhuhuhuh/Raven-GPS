import type { Place } from './geocode';
import { readJson, writeJson } from './storage';

const RECENTS = 'raven-gps:recents';
const SAVED = 'raven-gps:saved';
const MAX_RECENTS = 12;

export type SavedSlot = 'home' | 'work';
export type SavedPlaces = Partial<Record<SavedSlot, Place>>;

export function loadRecents(): Place[] {
  const recents = readJson<Place[]>(RECENTS, []);
  return Array.isArray(recents) ? recents.filter(place => Number.isFinite(place?.lat) && Number.isFinite(place?.lon)) : [];
}

export function rememberPlace(place: Place): Place[] {
  const recents = [place, ...loadRecents().filter(item => item.id !== place.id)].slice(0, MAX_RECENTS);
  writeJson(RECENTS, recents);
  return recents;
}

export function forgetRecents(): void {
  writeJson(RECENTS, []);
}

export function loadSaved(): SavedPlaces {
  const saved = readJson<SavedPlaces>(SAVED, {});
  return saved && typeof saved === 'object' ? saved : {};
}

export function savePlace(slot: SavedSlot, place: Place | null): SavedPlaces {
  const saved = { ...loadSaved() };
  if (place) saved[slot] = place;
  else delete saved[slot];
  writeJson(SAVED, saved);
  return saved;
}
