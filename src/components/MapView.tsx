import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { Camera, RouteCamera } from '../lib/cameras';
import type { Bounds, LonLat } from '../lib/geo';
import type { RouteOption } from '../lib/planner';
import { loadBasemap } from '../map/basemap';
import { CAMERA_STYLES, cameraClass, markerImage, type CameraClass } from '../map/markers';

export type MapCamera = { center: LonLat; bearing: number; zoom: number; pitch: number };

type Props = {
  options: RouteOption[];
  selectedId: string | null;
  /** While navigating: the part of the route still ahead. */
  ahead: LonLat[] | null;
  cameras: Camera[];
  routeCameras: RouteCamera[];
  position: { point: LonLat; heading: number } | null;
  destination: LonLat | null;
  follow: MapCamera | null;
  fitTo: Bounds | null;
  /** One-shot camera restore (e.g. back to the pre-trip view when a drive ends). */
  restoreTo: { center: LonLat; zoom: number } | null;
  onRestored: () => void;
  initialCenter: LonLat;
  initialZoom: number;
  onSelectRoute: (id: string) => void;
  onLongPress: (point: LonLat) => void;
  onUserMove: () => void;
  onViewChange: (bounds: Bounds, zoom: number) => void;
  onCameraClick: (camera: Camera) => void;
};

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const CLASSES = Object.keys(CAMERA_STYLES) as CameraClass[];

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const puck = useRef<maplibregl.Marker | null>(null);
  const pin = useRef<maplibregl.Marker | null>(null);
  const handlers = useRef(props);
  const [ready, setReady] = useState(false);
  handlers.current = props;

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    void loadBasemap().then(basemap => {
      if (disposed || !container.current) return;
      map = new maplibregl.Map({
        container: container.current,
        style: basemap.style,
        center: handlers.current.initialCenter,
        zoom: handlers.current.initialZoom,
        attributionControl: { compact: true },
        pitchWithRotate: true,
        maxPitch: 65
      });
      mapRef.current = map;
      const current = map;
      current.on('load', () => {
        for (const cameraKind of CLASSES) {
          current.addImage(`cam-${cameraKind}`, markerImage(cameraKind, false), { pixelRatio: 2 });
          current.addImage(`cam-${cameraKind}-alert`, markerImage(cameraKind, true), { pixelRatio: 2 });
        }
        current.addSource('routes', { type: 'geojson', data: EMPTY });
        current.addSource('ahead', { type: 'geojson', data: EMPTY });
        current.addSource('cameras', { type: 'geojson', data: EMPTY });
        current.addLayer({ id: 'routes-alt', type: 'line', source: 'routes', filter: ['!', ['get', 'selected']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#55627a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 7], 'line-opacity': 0.9 } });
        current.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', filter: ['get', 'selected'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a3a5c', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 15, 13] } });
        current.addLayer({ id: 'routes-main', type: 'line', source: 'routes', filter: ['get', 'selected'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#5ac8fa', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 15, 8] } });
        current.addLayer({ id: 'ahead-casing', type: 'line', source: 'ahead', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a3a5c', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 9, 17, 20] } });
        current.addLayer({ id: 'ahead-main', type: 'line', source: 'ahead', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#5ac8fa', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 17, 13] } });
        current.addLayer({
          id: 'cameras',
          type: 'symbol',
          source: 'cameras',
          layout: {
            'icon-image': ['concat', 'cam-', ['get', 'class'], ['case', ['get', 'alert'], '-alert', '']],
            'icon-allow-overlap': true,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 1],
            'symbol-sort-key': ['case', ['get', 'alert'], 1, 0]
          }
        });
        current.on('click', 'routes-alt', event => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === 'string') handlers.current.onSelectRoute(id);
        });
        current.on('click', 'cameras', event => {
          const id = Number(event.features?.[0]?.properties?.id);
          const found = [...handlers.current.cameras, ...handlers.current.routeCameras.map(hit => hit.camera)].find(camera => camera.id === id);
          if (found) handlers.current.onCameraClick(found);
        });
        for (const layer of ['routes-alt', 'cameras']) {
          current.on('mouseenter', layer, () => (current.getCanvas().style.cursor = 'pointer'));
          current.on('mouseleave', layer, () => (current.getCanvas().style.cursor = ''));
        }
        setReady(true);
      });
      const reportView = () => {
        const bounds = current.getBounds();
        handlers.current.onViewChange({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, current.getZoom());
      };
      current.on('moveend', reportView);
      current.on('dragstart', () => handlers.current.onUserMove());
      current.on('contextmenu', event => handlers.current.onLongPress([event.lngLat.lng, event.lngLat.lat]));
      // Touch long-press (contextmenu doesn't fire on every Android WebView).
      let pressTimer: ReturnType<typeof setTimeout> | null = null;
      current.on('touchstart', event => {
        if (event.originalEvent.touches.length !== 1) return;
        const { lng, lat } = event.lngLat;
        pressTimer = setTimeout(() => handlers.current.onLongPress([lng, lat]), 650);
      });
      const cancel = () => {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
      };
      current.on('touchend', cancel);
      current.on('touchmove', cancel);
      current.on('movestart', cancel);
    });
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Routes: every option, the selected one on top.
  useEffect(() => {
    const source = mapRef.current?.getSource('routes') as GeoJSONSource | undefined;
    if (!ready || !source) return;
    const features = props.options
      .map(option => ({
        type: 'Feature' as const,
        properties: { id: option.id, selected: option.id === props.selectedId && !props.ahead },
        geometry: { type: 'LineString' as const, coordinates: option.route.line.coordinates }
      }))
      .filter(feature => !props.ahead || feature.properties.selected);
    source.setData({ type: 'FeatureCollection', features });
  }, [ready, props.options, props.selectedId, props.ahead]);

  useEffect(() => {
    const source = mapRef.current?.getSource('ahead') as GeoJSONSource | undefined;
    if (!ready || !source) return;
    source.setData(props.ahead && props.ahead.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: props.ahead } } : EMPTY);
  }, [ready, props.ahead]);

  useEffect(() => {
    const source = mapRef.current?.getSource('cameras') as GeoJSONSource | undefined;
    if (!ready || !source) return;
    const onRoute = new Set(props.routeCameras.map(hit => hit.camera.id));
    const all = new Map<number, Camera>();
    for (const camera of props.cameras) all.set(camera.id, camera);
    for (const hit of props.routeCameras) all.set(hit.camera.id, hit.camera);
    source.setData({
      type: 'FeatureCollection',
      features: [...all.values()].map(camera => ({
        type: 'Feature',
        properties: { id: camera.id, class: cameraClass(camera.kinds), alert: onRoute.has(camera.id) },
        geometry: { type: 'Point', coordinates: [camera.lon, camera.lat] }
      }))
    });
  }, [ready, props.cameras, props.routeCameras]);

  // The position puck.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!props.position) {
      puck.current?.remove();
      puck.current = null;
      return;
    }
    if (!puck.current) {
      const element = document.createElement('div');
      element.className = 'puck';
      element.innerHTML = '<div class="puck-halo"></div><svg viewBox="0 0 40 40" class="puck-arrow" aria-hidden="true"><path d="M20 4 L32 34 L20 27 L8 34 Z" /></svg>';
      puck.current = new maplibregl.Marker({ element, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(props.position.point).addTo(map);
    }
    puck.current.setLngLat(props.position.point).setRotation(props.position.heading);
  }, [ready, props.position]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    pin.current?.remove();
    pin.current = null;
    if (props.destination) {
      const element = document.createElement('div');
      element.className = 'dest-pin';
      pin.current = new maplibregl.Marker({ element, anchor: 'bottom' }).setLngLat(props.destination).addTo(map);
    }
  }, [ready, props.destination]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.follow) return;
    const bottom = Math.round(map.getContainer().clientHeight * 0.42);
    map.easeTo({ center: props.follow.center, bearing: props.follow.bearing, zoom: props.follow.zoom, pitch: props.follow.pitch, padding: { top: 0, bottom, left: 0, right: 0 }, duration: 950, easing: t => t });
  }, [ready, props.follow]);

  // A single move back to a remembered view. Deliberately not a standing camera: re-issuing
  // one would fight `onViewChange`, because the follow camera pads the bottom of the map and
  // so never reports back the centre it was given.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.restoreTo) return;
    map.easeTo({ center: props.restoreTo.center, zoom: props.restoreTo.zoom, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 650 });
    handlers.current.onRestored();
  }, [ready, props.restoreTo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !props.fitTo) return;
    const { west, south, east, north } = props.fitTo;
    const height = map.getContainer().clientHeight;
    map.fitBounds([[west, south], [east, north]], { padding: { top: 110, bottom: Math.min(height * 0.5, 420), left: 40, right: 40 }, bearing: 0, pitch: 0, duration: 800, maxZoom: 16 });
  }, [ready, props.fitTo]);

  return <div ref={container} className="map" data-ready={ready ? 'true' : 'false'} />;
}
