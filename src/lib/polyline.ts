import type { LonLat } from './geo';

/** Decodes an encoded polyline (Valhalla uses precision 6) into [lon, lat] pairs. */
export function decodePolyline(encoded: string, precision = 6): LonLat[] {
  const factor = 10 ** precision;
  const coordinates: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    const deltas: number[] = [];
    for (let axis = 0; axis < 2; axis += 1) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        if (index >= encoded.length) throw new Error('Truncated polyline');
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    lat += deltas[0];
    lon += deltas[1];
    coordinates.push([lon / factor, lat / factor]);
  }
  return coordinates;
}

/** Encodes [lon, lat] pairs; the inverse of decodePolyline (used by tests and fixtures). */
export function encodePolyline(coordinates: LonLat[], precision = 6): string {
  const factor = 10 ** precision;
  let previousLat = 0;
  let previousLon = 0;
  let output = '';
  const encodeValue = (value: number) => {
    let current = value < 0 ? ~(value << 1) : value << 1;
    let chunk = '';
    while (current >= 0x20) {
      chunk += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
      current >>= 5;
    }
    return chunk + String.fromCharCode(current + 63);
  };
  for (const [lon, lat] of coordinates) {
    const latValue = Math.round(lat * factor);
    const lonValue = Math.round(lon * factor);
    output += encodeValue(latValue - previousLat) + encodeValue(lonValue - previousLon);
    previousLat = latValue;
    previousLon = lonValue;
  }
  return output;
}
