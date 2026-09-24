import { Geolocation } from '@capacitor/geolocation';
import { isNative } from './native';
import type { Fix } from './navigation';

export type LocationWatch = { stop(): void };

function toFix(coords: { longitude: number; latitude: number; speed: number | null; heading: number | null; accuracy: number }, timestamp: number): Fix {
  return {
    lon: coords.longitude,
    lat: coords.latitude,
    speed: coords.speed !== null && Number.isFinite(coords.speed) ? coords.speed : null,
    heading: coords.heading !== null && Number.isFinite(coords.heading) ? coords.heading : null,
    accuracy: coords.accuracy,
    time: timestamp
  };
}

/** Streams high-accuracy positions; on Android it asks for location permission first. */
export async function watchLocation(onFix: (fix: Fix) => void, onError: (message: string) => void): Promise<LocationWatch> {
  if (isNative()) {
    try {
      const status = await Geolocation.checkPermissions();
      if (status.location !== 'granted') {
        const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (requested.location !== 'granted') {
          onError('Location permission is needed for navigation.');
          return { stop() {} };
        }
      }
      const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0, minimumUpdateInterval: 1000 }, (position, error) => {
        if (position) onFix(toFix(position.coords, position.timestamp));
        else if (error) onError(error.message ?? 'Location unavailable');
      });
      return { stop: () => void Geolocation.clearWatch({ id }) };
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Location unavailable');
      return { stop() {} };
    }
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError('This browser has no location support.');
    return { stop() {} };
  }
  const id = navigator.geolocation.watchPosition(
    position => onFix(toFix(position.coords, position.timestamp)),
    error => onError(error.code === error.PERMISSION_DENIED ? 'Location permission was denied.' : 'Location unavailable'),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20_000 }
  );
  return { stop: () => navigator.geolocation.clearWatch(id) };
}
