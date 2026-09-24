import { ALPR, ENFORCEMENT, FLOCK } from '../lib/cameras';

/** Camera marker classes: each has its own color and shape, so they differ without color too. */
export const CAMERA_STYLES = {
  flock: { color: '#ff5a36', shape: 'diamond', label: 'Flock Safety' },
  alpr: { color: '#f5b83d', shape: 'circle', label: 'Plate reader' },
  enforcement: { color: '#a58bff', shape: 'triangle', label: 'Speed camera' }
} as const;

export type CameraClass = keyof typeof CAMERA_STYLES;

export function cameraClass(kinds: number): CameraClass {
  if (kinds & FLOCK) return 'flock';
  if (kinds & ALPR) return 'alpr';
  if (kinds & ENFORCEMENT) return 'enforcement';
  return 'alpr';
}

/** Draws a marker bitmap for map.addImage; `alert` adds a bright ring for cameras on the route. */
export function markerImage(cameraKind: CameraClass, alert: boolean, pixelRatio = 2): { width: number; height: number; data: Uint8ClampedArray } {
  const size = (alert ? 30 : 20) * pixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const { color, shape } = CAMERA_STYLES[cameraKind];
  const center = size / 2;
  const radius = (alert ? 8 : 6.5) * pixelRatio;
  if (alert) {
    context.beginPath();
    context.arc(center, center, 13 * pixelRatio, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 90, 54, 0.22)';
    context.fill();
    context.lineWidth = 1.5 * pixelRatio;
    context.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    context.stroke();
  }
  context.beginPath();
  if (shape === 'circle') context.arc(center, center, radius, 0, Math.PI * 2);
  else if (shape === 'diamond') {
    const r = radius * 1.25;
    context.moveTo(center, center - r);
    context.lineTo(center + r, center);
    context.lineTo(center, center + r);
    context.lineTo(center - r, center);
    context.closePath();
  } else {
    const r = radius * 1.3;
    context.moveTo(center, center - r);
    context.lineTo(center + r * 0.95, center + r * 0.7);
    context.lineTo(center - r * 0.95, center + r * 0.7);
    context.closePath();
  }
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 1.6 * pixelRatio;
  context.strokeStyle = '#0b0f17';
  context.stroke();
  const image = context.getImageData(0, 0, size, size);
  return { width: size, height: size, data: image.data };
}
