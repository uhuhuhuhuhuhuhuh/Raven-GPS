import { Share } from '@capacitor/share';
import {
  Briefcase, Clock, Download, House, LoaderCircle, LocateFixed, MapPin, Search, Settings as SettingsIcon, Share2, ShieldAlert, ShieldCheck,
  TriangleAlert, Volume2, VolumeX, X, FastForward, Route as RouteIcon, ExternalLink
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectorsSheet } from './components/ConnectorsSheet';
import { ManeuverIcon } from './components/ManeuverIcon';
import { MapView, type MapCamera } from './components/MapView';
import { MediaBar } from './components/MediaBar';
import { MediaBrowseSheet } from './components/MediaBrowseSheet';
import { SettingsSheet } from './components/SettingsSheet';
import type { Connector } from './lib/media';
import { CameraRepository } from './lib/cameraData';
import type { Camera, RouteCamera } from './lib/cameras';
import { distanceText, formatClock, formatDistance, formatDuration, speedValue } from './lib/format';
import { reversePlace, searchPlaces, type Place } from './lib/geocode';
import { watchCompass } from './lib/compass';
import { boundsOf, haversine, type Bounds, type LonLat } from './lib/geo';
import { watchLocation } from './lib/location';
import { RavenNative, isNative } from './lib/native';
import { advance, progress, simulatedFix, startNavigation, type Fix, type NavEvent, type NavState } from './lib/navigation';
import { loadRecents, loadSaved, rememberPlace, savePlace, type SavedPlaces, type SavedSlot } from './lib/places';
import { planRoutes, type CameraSource, type OptionKind, type RouteOption } from './lib/planner';
import { sliceLine } from './lib/routeLine';
import { avoidSummary, cameraMask, loadSettings, routePreferences, saveSettings, type Settings } from './lib/settings';
import { readJson, writeJson } from './lib/storage';
import { persistentCache } from './lib/tileCache';
import { useMedia } from './lib/useMedia';
import { useUpdate } from './lib/useUpdate';
import { valhallaFetcher, type ProfileId, type Route } from './lib/valhalla';
import { createVoice } from './lib/voice';

type Mode = 'browse' | 'preview' | 'navigate' | 'arrived';
type Nav = { option: RouteOption; state: NavState; simulated: boolean; rerouting: boolean };

const OPTION_TEXT: Record<OptionKind, { title: string; detail: string }> = {
  fastest: { title: 'Fastest', detail: 'Quickest drive with the fewest cameras found' },
  alternate: { title: 'Alternative', detail: 'Another way with no more cameras' },
  balanced: { title: 'In-between', detail: 'Fewer highways, a middle ground on time' },
  quiet: { title: 'Less traffic', detail: 'Stays off highways and expressways where traffic builds; takes longer' },
  direct: { title: 'Direct', detail: 'Ignores cameras' }
};
const KIND_ORDER: OptionKind[] = ['fastest', 'alternate', 'balanced', 'quiet', 'direct'];
const LAST_POSITION = 'raven-gps:last-position';
const params = new URLSearchParams(location.search);
const SIM_SPEED = Math.max(1, Number(params.get('simSpeed')) || 1);

function sortOptions(options: RouteOption[]) {
  return [...options].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function followZoom(speed: number) {
  return speed > 25 ? 14.6 : speed > 14 ? 15.4 : 16.3;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [mode, setMode] = useState<Mode>('browse');
  const [position, setPosition] = useState<Fix | null>(null);
  const [compass, setCompass] = useState<number | null>(null);
  const [restoreView, setRestoreView] = useState<{ center: LonLat; zoom: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [options, setOptions] = useState<RouteOption[]>([]);
  const [preview, setPreview] = useState<Route | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planning, setPlanning] = useState<{ busy: boolean; message: string; error: string | null }>({ busy: false, message: '', error: null });
  const [nav, setNav] = useState<Nav | null>(null);
  const [alert, setAlert] = useState<{ hit: RouteCamera; distance: number } | null>(null);
  const [follow, setFollow] = useState(true);
  const [fitTo, setFitTo] = useState<Bounds | null>(null);
  const [sheet, setSheet] = useState<'settings' | 'connectors' | 'browse' | null>(null);
  const [browseApp, setBrowseApp] = useState<Connector | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewCameras, setViewCameras] = useState<Camera[]>([]);
  const [cameraCard, setCameraCard] = useState<Camera | null>(null);
  const [saved, setSaved] = useState<SavedPlaces>(loadSaved);
  const [recents, setRecents] = useState<Place[]>(loadRecents);
  const [dataTimestamp, setDataTimestamp] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [simBoost, setSimBoost] = useState(1);
  const media = useMedia();
  const update = useUpdate();

  const repository = useMemo(() => new CameraRepository({ cache: persistentCache(), onChange: () => setRevision(value => value + 1) }), []);
  const cameraSource: CameraSource = useMemo(() => ({ ensureLine: (line, margin, signal) => repository.ensureLine(line, margin, signal), alongLine: (line, radius, mask) => repository.index.alongLine(line, radius, mask) }), [repository]);
  const voice = useMemo(() => createVoice(navigator.language || 'en-US'), []);
  const mask = cameraMask(settings);
  const initialView = useMemo(() => {
    const last = readJson<LonLat | null>(LAST_POSITION, null);
    return Array.isArray(last) ? { center: last, zoom: 13 } : { center: [-96, 38.5] as LonLat, zoom: 3.4 };
  }, []);
  const mapCenter = useRef<LonLat>(initialView.center);
  // The last browse-mode camera; used to restore the view after a drive ends when there's
  // no live position to follow (e.g. no GPS), instead of stranding on the simulated route.
  const browseView = useRef<{ center: LonLat; zoom: number }>({ center: initialView.center, zoom: initialView.zoom });
  const navRef = useRef<Nav | null>(null);
  navRef.current = nav;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const positionRef = useRef(position);
  positionRef.current = position;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const planAbort = useRef<AbortController | null>(null);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => voice.setEnabled(settings.voice), [voice, settings.voice]);
  useEffect(() => {
    void repository.tileIndex().then(index => setDataTimestamp(index?.dataTimestamp ?? null));
  }, [repository]);

  // ---- Navigation updates ------------------------------------------------------------
  const handleEvents = useCallback((events: NavEvent[], option: RouteOption) => {
    for (const event of events) {
      if (event.type === 'speak') voice.say(event.text);
      else if (event.type === 'camera') setAlert({ hit: event.hit, distance: event.distance });
      else if (event.type === 'arrived') {
        setMode('arrived');
        void RavenNative.setKeepAwake({ enabled: false }).catch(() => undefined);
      } else if (event.type === 'offRoute') void rerouteRef.current(option);
    }
  }, [voice]);

  const onNavFix = useCallback((fix: Fix) => {
    const current = navRef.current;
    if (!current) return;
    const cameras = settingsRef.current.cameraAlerts ? current.option.cameras : [];
    const result = advance(current.option.route, cameras, current.state, fix, settingsRef.current.units);
    const next = { ...current, state: result.state };
    navRef.current = next;
    setNav(next);
    handleEvents(result.events, current.option);
  }, [handleEvents]);

  const rerouteRef = useRef<(option: RouteOption) => Promise<void>>(async () => undefined);
  rerouteRef.current = async (option: RouteOption) => {
    const current = navRef.current;
    const fix = current?.state.lastFix;
    if (!current || !fix || current.rerouting || !destination) return;
    setNav({ ...current, rerouting: true });
    const profile: ProfileId = option.kind === 'balanced' || option.kind === 'quiet' ? option.kind : 'fastest';
    try {
      const [fresh] = await planRoutes(
        {
          origin: { lon: fix.lon, lat: fix.lat, ...(fix.heading !== null && current.state.speed > 3 ? { heading: fix.heading } : {}) },
          destination,
          profiles: [profile],
          preferences: routePreferences(settingsRef.current),
          avoid: { enabled: settingsRef.current.avoidCameras && option.kind !== 'direct', mask: cameraMask(settingsRef.current), radius: settingsRef.current.radius },
          seed: option.exclusions,
          budget: 4
        },
        valhallaFetcher(settingsRef.current.routingEndpoint),
        cameraSource
      );
      if (!fresh || navRef.current !== null && navRef.current.option !== current.option) return;
      const replacement: RouteOption = { ...fresh, kind: option.kind, id: `${option.kind}-reroute-${Date.now()}` };
      const started = startNavigation(replacement.route, { announceStart: true });
      const next: Nav = { option: replacement, state: started.state, simulated: current.simulated, rerouting: false };
      navRef.current = next;
      setNav(next);
      handleEvents(started.events, replacement);
    } catch {
      const latest = navRef.current;
      if (latest) {
        // Let the next off-route report try again.
        const next = { ...latest, rerouting: false, state: { ...latest.state, offRouteReported: false, offRouteSince: null } };
        navRef.current = next;
        setNav(next);
      }
    }
  };

  // ---- Compass -------------------------------------------------------------------------
  // Used for the map arrow when GPS has no course to give (stopped, or barely moving).
  useEffect(() => {
    const watch = watchCompass(setCompass);
    return () => watch.stop();
  }, []);

  // ---- Location ------------------------------------------------------------------------
  useEffect(() => {
    let watch: { stop(): void } | null = null;
    let cancelled = false;
    void watchLocation(fix => {
      setGpsError(null);
      if (navRef.current?.simulated) return;
      setPosition(fix);
      writeJson(LAST_POSITION, [Number(fix.lon.toFixed(4)), Number(fix.lat.toFixed(4))]);
      onNavFix(fix);
    }, setGpsError).then(handle => {
      if (cancelled) handle.stop();
      else watch = handle;
    });
    return () => {
      cancelled = true;
      watch?.stop();
    };
  }, [onNavFix]);

  // Simulated drive.
  useEffect(() => {
    if (mode !== 'navigate' || !nav?.simulated) return;
    const routeAtStart = nav.option.route;
    let elapsed = 0;
    const origin = Date.now();
    const timer = setInterval(() => {
      const current = navRef.current;
      if (!current) return;
      elapsed += SIM_SPEED * simBoost;
      const fix = simulatedFix(current.option.route === routeAtStart ? routeAtStart : current.option.route, elapsed, origin);
      // Drive the on-route marker via nav.state (onNavFix) only. Writing simulated
      // fixes into `position` leaves it stranded at the sim's last point once the
      // drive ends (no real fix overwrites it without GPS), parking the camera and
      // poisoning the next plan origin / search. Real fixes still update `position`.
      onNavFix(fix);
    }, 1000);
    return () => clearInterval(timer);
    // Restart only when a new simulated drive begins or the speed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nav?.simulated, nav?.option.id, simBoost, onNavFix]);

  // ---- Planning --------------------------------------------------------------------------
  const plan = useCallback(async (place: Place) => {
    planAbort.current?.abort();
    const controller = new AbortController();
    planAbort.current = controller;
    const origin = position ? { lon: position.lon, lat: position.lat } : { lon: mapCenter.current[0], lat: mapCenter.current[1] };
    setOptions([]);
    setPreview(null);
    setSelectedId(null);
    setPlanning({ busy: true, message: 'Finding routes…', error: null });
    setFitTo(boundsOf([[origin.lon, origin.lat], [place.lon, place.lat]]));
    const titles: Record<ProfileId, string> = { fastest: 'fastest', balanced: 'in-between', quiet: 'less-traffic' };
    try {
      await planRoutes(
        {
          origin,
          destination: { lon: place.lon, lat: place.lat },
          profiles: ['fastest', 'balanced', 'quiet'],
          alternates: true,
          preferences: routePreferences(settings),
          avoid: { enabled: settings.avoidCameras, mask, radius: settings.radius },
          signal: controller.signal,
          onPreview: route => {
            setPreview(route);
            setFitTo(boundsOf(route.line.coordinates));
          },
          onProgress: step => setPlanning({ busy: true, message: settings.avoidCameras && mask ? `Checking the ${titles[step.kind as ProfileId]} route for cameras…${step.excluded ? ` (${step.excluded} avoided so far)` : ''}` : `Finding the ${titles[step.kind as ProfileId]} route…`, error: null }),
          onOption: (option, all) => {
            setOptions(sortOptions(all));
            setSelectedId(previous => previous ?? option.id);
          }
        },
        valhallaFetcher(settings.routingEndpoint),
        cameraSource
      );
      if (!controller.signal.aborted) setPlanning({ busy: false, message: '', error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPlanning({ busy: false, message: '', error: error instanceof Error ? error.message : 'Routing failed' });
    }
  }, [position, settings, mask, cameraSource]);

  const chooseDestination = useCallback((place: Place) => {
    setDestination(place);
    setRecents(rememberPlace(place));
    setSearchOpen(false);
    setMode('preview');
    setFollow(false);
    void plan(place);
  }, [plan]);

  const cancelPreview = useCallback(() => {
    planAbort.current?.abort();
    // With no live fix there's nothing to follow back to, so put the map where it was.
    if (!positionRef.current) setRestoreView(browseView.current);
    setMode('browse');
    setDestination(null);
    setOptions([]);
    setPreview(null);
    setPlanning({ busy: false, message: '', error: null });
    setFollow(true);
  }, []);

  const selected = options.find(option => option.id === selectedId) ?? options[0] ?? null;

  const startDrive = useCallback((simulated: boolean) => {
    if (!selected) return;
    planAbort.current?.abort();
    const started = startNavigation(selected.route, { announceStart: true });
    const next: Nav = { option: selected, state: started.state, simulated, rerouting: false };
    navRef.current = next;
    setNav(next);
    setMode('navigate');
    setFollow(true);
    setAlert(null);
    setPlanning(value => ({ ...value, busy: false }));
    handleEvents(started.events, selected);
    void RavenNative.setKeepAwake({ enabled: true }).catch(() => undefined);
  }, [selected, handleEvents]);

  const endDrive = useCallback(() => {
    if (!positionRef.current) setRestoreView(browseView.current);
    setNav(null);
    navRef.current = null;
    setMode('browse');
    setDestination(null);
    setOptions([]);
    setPreview(null);
    setAlert(null);
    setFollow(true);
    void RavenNative.setKeepAwake({ enabled: false }).catch(() => undefined);
    void RavenNative.stopSpeaking().catch(() => undefined);
  }, []);

  // ---- Map cameras -----------------------------------------------------------------------
  const viewRef = useRef<{ bounds: Bounds; zoom: number } | null>(null);
  const refreshViewCameras = useCallback(() => {
    const view = viewRef.current;
    if (!view || !settings.showCameras || !mask || view.zoom < 10) {
      setViewCameras([]);
      return;
    }
    setViewCameras(repository.index.inBounds(view.bounds, mask, 4000));
  }, [repository, settings.showCameras, mask]);

  const onViewChange = useCallback((bounds: Bounds, zoom: number) => {
    viewRef.current = { bounds, zoom };
    mapCenter.current = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
    if (modeRef.current === 'browse') browseView.current = { center: mapCenter.current, zoom };
    if (settings.showCameras && zoom >= 10) void repository.ensureBounds(bounds, undefined, 6).catch(() => null);
    refreshViewCameras();
  }, [repository, settings.showCameras, refreshViewCameras]);

  useEffect(() => refreshViewCameras(), [revision, refreshViewCameras]);

  // Clear a camera alert once it's behind us.
  useEffect(() => {
    if (!alert || !nav) return;
    const distance = alert.hit.along - nav.state.along;
    if (distance < -30) setAlert(null);
    else if (Math.abs(distance - alert.distance) > 20) setAlert({ ...alert, distance: Math.max(0, distance) });
  }, [alert, nav]);

  // ---- Derived view state ----------------------------------------------------------------
  const livePoint: LonLat | null = nav?.state.snapped ?? (position ? [position.lon, position.lat] : null);
  // GPS only reports a course while moving, so below walking pace prefer the compass: otherwise
  // the arrow keeps pointing wherever we were last heading until the next move.
  const speedNow = nav ? nav.state.speed : position?.speed ?? 0;
  const courseNow = nav ? nav.state.heading : position?.heading ?? null;
  const heading = (speedNow > 1.5 && courseNow !== null ? courseNow : compass ?? courseNow) ?? 0;
  // Browsing is north-up, so only the navigate camera turns with the heading; keeping the
  // compass out of the browse camera stops it re-easing on every magnetometer sample.
  const followBearing = mode === 'navigate' ? heading : 0;
  const mapFollow: MapCamera | null = useMemo(() => {
    if (!follow || !livePoint) return null;
    if (mode === 'navigate' && nav) return { center: livePoint, bearing: followBearing, zoom: followZoom(nav.state.speed), pitch: 55 };
    if (mode === 'browse') return { center: livePoint, bearing: 0, zoom: 15, pitch: 0 };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, mode, livePoint?.[0], livePoint?.[1], followBearing, nav?.state.speed]);

  const navProgress = nav ? progress(nav.option.route, settings.cameraAlerts ? nav.option.cameras : [], nav.state) : null;
  const ahead = nav ? sliceLine(nav.option.route.line, nav.state.along) : null;
  const mapOptions = mode === 'navigate' && nav ? [nav.option] : options.length ? options : preview ? [{ id: 'preview', kind: 'fastest' as const, route: preview, cameras: [], avoided: 0, exclusions: [], dataComplete: true }] : [];
  const routeCameras = mode === 'navigate' && nav ? nav.option.cameras : selected?.cameras ?? [];
  const quickest = options.length ? Math.min(...options.map(option => option.route.time)) : 0;
  const speed = speedValue(nav ? nav.state.speed : position?.speed, settings.units);

  const shareEta = useCallback(async () => {
    if (!destination || !navProgress) return;
    const eta = formatClock(new Date(Date.now() + navProgress.remainingTime * 1000));
    const text = `On my way to ${destination.name}, arriving around ${eta}.`;
    const url = `https://www.openstreetmap.org/?mlat=${destination.lat.toFixed(5)}&mlon=${destination.lon.toFixed(5)}#map=16/${destination.lat.toFixed(5)}/${destination.lon.toFixed(5)}`;
    try {
      if (isNative()) await Share.share({ title: 'My ETA', text, url, dialogTitle: 'Share ETA' });
      else if (navigator.share) await navigator.share({ title: 'My ETA', text, url });
      else await navigator.clipboard.writeText(`${text} ${url}`);
    } catch {
      // share sheet dismissed
    }
  }, [destination, navProgress]);

  const setSavedSlot = useCallback((slot: SavedSlot, place: Place | null) => setSaved(savePlace(slot, place)), []);

  return (
    <div className={`app mode-${mode}`}>
      <MapView
        options={mapOptions}
        selectedId={mode === 'navigate' ? nav?.option.id ?? null : selected?.id ?? (preview ? 'preview' : null)}
        ahead={mode === 'navigate' ? ahead : null}
        cameras={viewCameras}
        routeCameras={routeCameras}
        position={livePoint ? { point: livePoint, heading } : null}
        destination={destination ? [destination.lon, destination.lat] : null}
        follow={mapFollow}
        fitTo={mode === 'preview' ? fitTo : null}
        restoreTo={restoreView}
        onRestored={() => setRestoreView(null)}
        initialCenter={initialView.center}
        initialZoom={initialView.zoom}
        onSelectRoute={id => setSelectedId(id)}
        onLongPress={point => {
          if (mode !== 'browse' && mode !== 'preview') return;
          void reversePlace(point).then(chooseDestination);
        }}
        onUserMove={() => setFollow(false)}
        onViewChange={onViewChange}
        onCameraClick={setCameraCard}
      />

      {mode === 'browse' && (
        <>
          <header className="topbar">
            <button className="search-trigger" onClick={() => setSearchOpen(true)} data-testid="search-open">
              <Search size={20} aria-hidden />
              <span>Where to?</span>
            </button>
            <button className="icon-button glass" onClick={() => setSheet('settings')} aria-label="Settings"><SettingsIcon size={20} /></button>
          </header>
          <div className="status-chips">
            <button className={`chip ${settings.avoidCameras && mask ? 'chip-good' : 'chip-warn'}`} onClick={() => setSheet('settings')}>
              {settings.avoidCameras && mask ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
              {settings.avoidCameras && mask ? `Avoiding ${avoidSummary(settings)}` : 'Camera avoidance off'}
            </button>
            {gpsError && <span className="chip chip-warn"><TriangleAlert size={15} /> {gpsError}</span>}
            {update.info?.available && <button className="chip chip-good" onClick={() => setSheet('settings')}><Download size={15} /> Update available</button>}
          </div>
        </>
      )}

      {mode !== 'navigate' && !follow && position && (
        <button className="fab recenter" onClick={() => setFollow(true)} aria-label="Center on my location"><LocateFixed size={22} /></button>
      )}

      {mode === 'browse' && (
        <div className="bottom-stack">
          <div className="quick-places">
            {(['home', 'work'] as SavedSlot[]).map(slot => {
              const place = saved[slot];
              return (
                <button key={slot} className="place-chip" onClick={() => (place ? chooseDestination(place) : setSearchOpen(true))}>
                  {slot === 'home' ? <House size={16} /> : <Briefcase size={16} />}
                  <span><strong>{slot === 'home' ? 'Home' : 'Work'}</strong><small>{place ? place.name : 'Set place'}</small></span>
                </button>
              );
            })}
            {recents.slice(0, 3).map(place => (
              <button key={place.id} className="place-chip" onClick={() => chooseDestination(place)}>
                <Clock size={16} />
                <span><strong>{place.name}</strong><small>{place.detail || 'Recent'}</small></span>
              </button>
            ))}
          </div>
          <MediaBar nowPlaying={media.nowPlaying} preferred={settings.mediaApp} onControl={media.control} onOpenConnectors={() => setSheet('connectors')} />
        </div>
      )}

      {searchOpen && (
        <SearchPanel
          near={position ? [position.lon, position.lat] : mapCenter.current}
          recents={recents}
          saved={saved}
          onPick={chooseDestination}
          onSave={setSavedSlot}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {mode === 'preview' && destination && (
        <section className="route-panel" data-testid="route-panel">
          <header className="route-head">
            <div>
              <h2>{destination.name}</h2>
              <p>{destination.detail}</p>
            </div>
            <button className="icon-button" onClick={cancelPreview} aria-label="Close routes"><X size={20} /></button>
          </header>
          {!position && <p className="note warn">Your location isn't available, so routes start from the middle of the map.</p>}
          {planning.busy && (
            <p className="planning" role="status"><LoaderCircle size={16} className="spin" /> {planning.message}</p>
          )}
          {planning.error && <p className="note bad" role="alert">{planning.error}</p>}
          <ul className="options" aria-label="Route options">
            {options.map(option => {
              const text = OPTION_TEXT[option.kind];
              const count = option.cameras.length;
              const clean = count === 0;
              return (
                <li key={option.id}>
                  <button className={`option${option.id === selected?.id ? ' selected' : ''}`} onClick={() => setSelectedId(option.id)} data-kind={option.kind}>
                    <span className="option-top">
                      <strong className="option-title">{text.title}</strong>
                      <span className={`badge ${clean ? 'good' : option.kind === 'direct' ? 'bad' : 'warn'}`}>
                        {mask === 0 ? 'Cameras not tracked' : clean ? 'No cameras' : `${count} camera${count === 1 ? '' : 's'}`}
                      </span>
                    </span>
                    <span className="option-time">
                      <b>{formatDuration(option.route.time)}</b>
                      <span>{distanceText(option.route.length, settings.units)}</span>
                      {option.route.time - quickest >= 60 && <span className="delta">+{formatDuration(option.route.time - quickest)}</span>}
                    </span>
                    <small className="option-detail">
                      {text.detail}
                      {option.avoided > 0 && ` · avoids ${option.avoided} on the direct route`}
                      {option.route.hasToll && ' · tolls'}
                      {!option.dataComplete && ' · camera data incomplete'}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="route-actions">
            <button className="primary big" disabled={!selected} onClick={() => startDrive(false)} data-testid="start">
              <RouteIcon size={20} /> Start{selected ? ` · ${formatDuration(selected.route.time)}` : ''}
            </button>
            <button className="secondary" disabled={!selected} onClick={() => startDrive(true)}>Preview drive</button>
          </div>
          <p className="fineprint">
            {settings.avoidCameras && mask ? `Avoiding ${avoidSummary(settings)} mapped in OpenStreetMap. Unmapped cameras can't be avoided.` : 'Camera avoidance is off in Settings.'}{' '}
            No live traffic data: "Less traffic" skips the highways where it usually builds. <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Fix the map</a>
          </p>
        </section>
      )}

      {mode === 'navigate' && nav && navProgress && (
        <>
          <header className="nav-banner" data-testid="nav-banner">
            <div className="nav-main">
              <span className="nav-icon"><ManeuverIcon type={navProgress.maneuver?.type} /></span>
              <div className="nav-text">
                <span className="nav-distance">
                  {(() => {
                    const { value, unit } = formatDistance(navProgress.distanceToManeuver, settings.units);
                    return <><b>{value}</b> {unit}</>;
                  })()}
                </span>
                <span className="nav-instruction">
                  {navProgress.maneuver?.exitNumber && <span className="exit">Exit {navProgress.maneuver.exitNumber}</span>}
                  {navProgress.maneuver?.streetNames[0] ?? navProgress.maneuver?.toward ?? navProgress.maneuver?.instruction}
                </span>
              </div>
            </div>
            {navProgress.following && navProgress.distanceToManeuver < 1500 && navProgress.maneuver && navProgress.maneuver.length < 400 && (
              <div className="nav-then">Then <ManeuverIcon type={navProgress.following.type} size={18} /> {navProgress.following.streetNames[0] ?? ''}</div>
            )}
          </header>
          {nav.rerouting && <div className="nav-pill" role="status"><LoaderCircle size={15} className="spin" /> Rerouting around cameras…</div>}
          {!nav.rerouting && alert && (
            <div className="nav-pill alert" role="alert" data-testid="camera-alert">
              <TriangleAlert size={16} /> {alert.hit.camera.label} · {distanceText(alert.distance, settings.units)}
            </div>
          )}
          {speed !== null && <div className="speed" aria-label="Speed"><b>{speed}</b><small>{settings.units === 'mi' ? 'mph' : 'km/h'}</small></div>}
          {!follow && <button className="fab recenter nav" onClick={() => setFollow(true)} aria-label="Resume following"><LocateFixed size={22} /></button>}
          <div className="nav-bottom">
            <MediaBar compact nowPlaying={media.nowPlaying} preferred={settings.mediaApp} onControl={media.control} onOpenConnectors={() => setSheet('connectors')} />
            <footer className="nav-footer">
              <button className="icon-button danger" onClick={endDrive} aria-label="End navigation"><X size={22} /></button>
              <div className="eta">
                <b>{formatClock(new Date(Date.now() + navProgress.remainingTime * 1000))}</b>
                <span>{formatDuration(navProgress.remainingTime)} · {distanceText(navProgress.remainingDistance, settings.units)}</span>
                <small className={navProgress.nextCamera ? 'warn' : 'good'}>
                  {!mask ? 'Cameras not tracked' : navProgress.nextCamera ? `Next camera in ${distanceText(navProgress.nextCamera.distance, settings.units)}` : 'No cameras ahead'}
                </small>
              </div>
              <div className="nav-tools">
                {nav.simulated && (
                  <button className={`icon-button${simBoost > 1 ? ' active' : ''}`} onClick={() => setSimBoost(value => (value > 1 ? 1 : 4))} aria-label="Fast forward"><FastForward size={20} /></button>
                )}
                <button className="icon-button" onClick={shareEta} aria-label="Share ETA"><Share2 size={20} /></button>
                <button className="icon-button" onClick={() => setSettings({ ...settings, voice: !settings.voice })} aria-label={settings.voice ? 'Mute voice' : 'Unmute voice'}>
                  {settings.voice ? <Volume2 size={20} /> : <VolumeX size={20} />}
                </button>
              </div>
            </footer>
          </div>
        </>
      )}

      {mode === 'arrived' && destination && (
        <section className="route-panel arrived" data-testid="arrived">
          <MapPin size={28} className="arrived-icon" />
          <h2>You've arrived</h2>
          <p>{destination.name}</p>
          <button className="primary big" onClick={endDrive}>Done</button>
        </section>
      )}

      {cameraCard && (
        <div className="camera-card" role="dialog" aria-label="Camera details">
          <header>
            <strong>{cameraCard.label}</strong>
            <button className="icon-button" onClick={() => setCameraCard(null)} aria-label="Close"><X size={18} /></button>
          </header>
          {cameraCard.operator && <p>Operated by {cameraCard.operator}</p>}
          {cameraCard.directions.length > 0 && <p>Facing {cameraCard.directions.map(value => `${Math.round(value)}°`).join(', ')}</p>}
          {position && <p>{distanceText(haversine([position.lon, position.lat], [cameraCard.lon, cameraCard.lat]), settings.units)} away</p>}
          <a href={`https://www.openstreetmap.org/node/${cameraCard.id}`} target="_blank" rel="noreferrer">View in OpenStreetMap <ExternalLink size={12} /></a>
        </div>
      )}

      {sheet === 'settings' && (
        <SettingsSheet settings={settings} dataTimestamp={dataTimestamp} update={update} onChange={setSettings} onClose={() => setSheet(null)} onOpenConnectors={() => setSheet('connectors')} />
      )}
      {sheet === 'connectors' && (
        <ConnectorsSheet
          native={media.native}
          granted={media.granted}
          installed={media.installed}
          preferred={settings.mediaApp}
          onGrant={media.grant}
          onLaunch={media.launch}
          onBrowse={connector => { setBrowseApp(connector); setSheet('browse'); }}
          onPrefer={packageName => setSettings({ ...settings, mediaApp: packageName })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'browse' && browseApp && (
        <MediaBrowseSheet
          connector={browseApp}
          browse={media.browse}
          play={media.play}
          onOpenApp={() => media.launch(browseApp.package, browseApp.web)}
          onClose={() => setSheet('connectors')}
        />
      )}
    </div>
  );
}

function SearchPanel({ near, recents, saved, onPick, onSave, onClose }: {
  near: LonLat;
  recents: Place[];
  saved: SavedPlaces;
  onPick: (place: Place) => void;
  onSave: (slot: SavedSlot, place: Place | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [saving, setSaving] = useState<SavedSlot | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus('loading');
      searchPlaces(text, near, controller.signal)
        .then(places => {
          setResults(places);
          setStatus('idle');
        })
        .catch(() => !controller.signal.aborted && setStatus('error'));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, near]);

  const pick = (place: Place) => {
    if (saving) {
      onSave(saving, place);
      setSaving(null);
      setQuery('');
      return;
    }
    onPick(place);
  };
  const list = query.trim().length >= 2 ? results : recents;

  return (
    <section className="search-panel" role="dialog" aria-label="Search">
      <div className="search-row">
        <Search size={20} aria-hidden />
        <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={saving ? `Search for your ${saving} address` : 'Search places or addresses'} aria-label="Search places" />
        <button className="icon-button" onClick={onClose} aria-label="Close search"><X size={20} /></button>
      </div>
      {!query && (
        <div className="saved-row">
          {(['home', 'work'] as SavedSlot[]).map(slot => (
            <button key={slot} className={`place-chip${saving === slot ? ' active' : ''}`} onClick={() => (saved[slot] && !saving ? onPick(saved[slot]!) : setSaving(slot))}>
              {slot === 'home' ? <House size={16} /> : <Briefcase size={16} />}
              <span><strong>{slot === 'home' ? 'Home' : 'Work'}</strong><small>{saved[slot]?.name ?? 'Set place'}</small></span>
            </button>
          ))}
          {(saved.home || saved.work) && !saving && <button className="text-button" onClick={() => setSaving(saved.home ? 'work' : 'home')}>Change</button>}
        </div>
      )}
      {saving && <p className="note">Pick a result to save it as {saving}. <button className="text-button" onClick={() => setSaving(null)}>Cancel</button></p>}
      {status === 'loading' && <p className="planning"><LoaderCircle size={16} className="spin" /> Searching…</p>}
      {status === 'error' && <p className="note bad">Search is unavailable right now.</p>}
      <ul className="results" aria-label={query ? 'Search results' : 'Recent places'}>
        {!query && recents.length > 0 && <li className="results-label">Recent</li>}
        {list.map(place => (
          <li key={place.id}>
            <button className="result" onClick={() => pick(place)}>
              <MapPin size={18} aria-hidden />
              <span><strong>{place.name}</strong><small>{place.detail}</small></span>
              <em>{distanceText(haversine(near, [place.lon, place.lat]), loadSettings().units)}</em>
            </button>
          </li>
        ))}
        {query.trim().length >= 2 && status === 'idle' && results.length === 0 && <li className="results-label">No matches</li>}
      </ul>
      <p className="fineprint">Tip: long-press the map to drive to any spot. Search by Photon · © OpenStreetMap contributors</p>
    </section>
  );
}
