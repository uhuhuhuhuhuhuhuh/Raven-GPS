/**
 * Device compass heading, in degrees clockwise from north.
 *
 * GPS only reports a course while you are actually moving, so standing still (or crawling in
 * traffic) leaves the map arrow pointing at whatever direction you were last travelling. The
 * magnetometer gives an immediate heading at any speed, which is what we fall back to.
 */
export type CompassWatch = { stop(): void };

type AbsoluteOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

const normalize = (degrees: number) => ((degrees % 360) + 360) % 360;

/** Screen rotation has to be added back in: alpha is relative to the device, not the screen. */
function screenAngle(): number {
  if (typeof screen === 'undefined') return 0;
  const angle = screen.orientation?.angle;
  return typeof angle === 'number' && Number.isFinite(angle) ? angle : 0;
}

/**
 * Streams compass headings. Reports only changes of at least `minChange` degrees, so a noisy
 * magnetometer doesn't re-render the map on every sample.
 */
export function watchCompass(onHeading: (heading: number) => void, minChange = 2): CompassWatch {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return { stop() {} };
  let last: number | null = null;
  const handle = (event: Event) => {
    const orientation = event as AbsoluteOrientationEvent;
    let heading: number | null = null;
    if (typeof orientation.webkitCompassHeading === 'number' && Number.isFinite(orientation.webkitCompassHeading)) {
      // iOS reports a true compass heading directly.
      heading = normalize(orientation.webkitCompassHeading + screenAngle());
    } else if (orientation.absolute && typeof orientation.alpha === 'number' && Number.isFinite(orientation.alpha)) {
      heading = normalize(360 - orientation.alpha + screenAngle());
    }
    if (heading === null) return;
    // Compare the short way round so 359 -> 1 counts as a 2 degree move, not 358.
    const delta = last === null ? Infinity : Math.abs(((heading - last + 540) % 360) - 180);
    if (delta < minChange) return;
    last = heading;
    onHeading(heading);
  };
  window.addEventListener('deviceorientationabsolute', handle);
  window.addEventListener('deviceorientation', handle);
  return {
    stop() {
      window.removeEventListener('deviceorientationabsolute', handle);
      window.removeEventListener('deviceorientation', handle);
    }
  };
}
