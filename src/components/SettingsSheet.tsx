import { Download, ExternalLink, Music, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_ROUTING_ENDPOINT } from '../lib/valhalla';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';
import type { UpdateInfo } from '../lib/update';
import { Segmented, Sheet, Toggle } from './Sheet';

type UpdateProps = {
  native: boolean;
  info: UpdateInfo | null;
  checking: boolean;
  installing: boolean;
  check: () => void;
  install: () => void;
};

type Props = {
  settings: Settings;
  dataTimestamp: string | null;
  update: UpdateProps;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  onOpenConnectors: () => void;
};

export function SettingsSheet({ settings, dataTimestamp, update, onChange, onClose, onOpenConnectors }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  const [endpoint, setEndpoint] = useState(settings.routingEndpoint);
  const nothingSelected = !settings.avoidFlock && !settings.avoidPlateReaders && !settings.avoidEnforcement;
  return (
    <Sheet title="Settings" onClose={onClose} className="settings-sheet">
      <h3>Cameras</h3>
      <Toggle label="Avoid cameras" detail="Plan routes that go around the cameras selected below" checked={settings.avoidCameras} onChange={value => set('avoidCameras', value)} />
      <div className={`group${settings.avoidCameras ? '' : ' muted'}`}>
        <Toggle label="Flock Safety devices" detail="Flock plate readers and other Flock sensors" checked={settings.avoidFlock} onChange={value => set('avoidFlock', value)} />
        <Toggle label="All license plate readers" detail="Every ALPR, whoever makes it (Motorola/Vigilant, Genetec, Rekor…)" checked={settings.avoidPlateReaders} onChange={value => set('avoidPlateReaders', value)} />
        <Toggle label="Speed & red-light cameras" checked={settings.avoidEnforcement} onChange={value => set('avoidEnforcement', value)} />
        {nothingSelected && <p className="note warn">No camera types selected: nothing will be avoided or announced.</p>}
      </div>
      <Segmented label="Counts as passing within" value={settings.radius} options={[25, 35, 50, 75].map(value => ({ value, label: `${value} m` }))} onChange={value => set('radius', value)} />
      <Toggle label="Camera alerts" detail="Warn when a camera is ahead on your route" checked={settings.cameraAlerts} onChange={value => set('cameraAlerts', value)} />
      <Toggle label="Show cameras on the map" checked={settings.showCameras} onChange={value => set('showCameras', value)} />

      <h3>Routes</h3>
      <Toggle label="Avoid tolls" checked={settings.avoidTolls} onChange={value => set('avoidTolls', value)} />
      <Toggle label="Avoid highways" checked={settings.avoidHighways} onChange={value => set('avoidHighways', value)} />
      <Toggle label="Avoid ferries" checked={settings.avoidFerries} onChange={value => set('avoidFerries', value)} />

      <h3>Guidance</h3>
      <Toggle label="Voice guidance" checked={settings.voice} onChange={value => set('voice', value)} />
      <Segmented label="Units" value={settings.units} options={[{ value: 'mi', label: 'Miles' }, { value: 'km', label: 'Kilometers' }]} onChange={value => set('units', value)} />

      <h3>Music & audio</h3>
      <button className="row-button" onClick={onOpenConnectors}><Music size={18} /> Connect Spotify, Plexamp, YouTube Music…</button>

      {update.native && (
        <>
          <h3>Updates</h3>
          {update.info?.available ? (
            <div className="callout">
              <p>Raven GPS {update.info.versionName ?? 'update'} is available.</p>
              <button className="primary" onClick={update.install} disabled={update.installing}>
                <Download size={16} /> {update.installing ? 'Downloading…' : 'Download & install'}
              </button>
            </div>
          ) : (
            <button className="row-button" onClick={update.check} disabled={update.checking}>
              <RefreshCw size={18} /> {update.checking ? 'Checking…' : "You're up to date · Check again"}
            </button>
          )}
        </>
      )}

      <h3>Advanced</h3>
      <label className="field">
        <span>Routing server (Valhalla)</span>
        <input value={endpoint} onChange={event => setEndpoint(event.target.value)} onBlur={() => set('routingEndpoint', endpoint.trim() || DEFAULT_ROUTING_ENDPOINT)} inputMode="url" spellCheck={false} />
      </label>
      <button className="row-button subtle" onClick={() => { setEndpoint(DEFAULT_SETTINGS.routingEndpoint); onChange({ ...DEFAULT_SETTINGS, mediaApp: settings.mediaApp }); }}>Reset all settings</button>

      <h3>About</h3>
      <p className="note">
        Camera locations: OpenStreetMap contributors (ODbL), via <a href="https://uhuhuhuhuhuhuhuh.github.io/Raven/" target="_blank" rel="noreferrer">Raven</a>
        {dataTimestamp ? `, data as of ${new Date(dataTimestamp).toLocaleDateString()}` : ''}. Routing: Valhalla on FOSSGIS servers. Search: Photon by komoot. Map: OpenFreeMap.
        Only mapped cameras can be avoided; add missing ones at <a href="https://deflock.me" target="_blank" rel="noreferrer">DeFlock</a> or <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">fix the map <ExternalLink size={12} /></a>.
      </p>
    </Sheet>
  );
}
