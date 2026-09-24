import { Check, ShieldCheck } from 'lucide-react';
import { CONNECTORS } from '../lib/media';
import { Sheet } from './Sheet';

type Props = {
  native: boolean;
  granted: boolean;
  installed: string[];
  preferred: string | null;
  onGrant: () => void;
  onLaunch: (packageName: string, web: string) => void;
  onPrefer: (packageName: string) => void;
  onClose: () => void;
};

export function ConnectorsSheet({ native, granted, installed, preferred, onGrant, onLaunch, onPrefer, onClose }: Props) {
  const sorted = [...CONNECTORS].sort((a, b) => Number(installed.includes(b.package)) - Number(installed.includes(a.package)));
  return (
    <Sheet title="Music & audio" onClose={onClose} className="connectors-sheet">
      {native ? (
        granted ? (
          <p className="note good"><ShieldCheck size={16} /> Connected: Raven GPS shows what's playing and can play, pause and skip in any of these apps.</p>
        ) : (
          <div className="callout">
            <p>Allow <strong>notification access</strong> so Raven GPS can show what's playing and control Spotify, Plexamp and other players. Nothing is read or sent anywhere else.</p>
            <button className="primary" onClick={onGrant}>Allow access</button>
          </div>
        )
      ) : (
        <p className="note">Playback controls work in the Android app. Here, these open each service's web player.</p>
      )}
      <ul className="connector-grid">
        {sorted.map(connector => {
          const isInstalled = installed.includes(connector.package);
          return (
            <li key={connector.id}>
              <button className={`connector${preferred === connector.package ? ' preferred' : ''}`} onClick={() => { onPrefer(connector.package); onLaunch(connector.package, connector.web); }}>
                <span className="connector-badge" style={{ background: connector.color }}>{connector.name[0]}</span>
                <span className="connector-name">{connector.name}</span>
                {native && <small>{isInstalled ? 'Installed' : 'Get app'}</small>}
                {preferred === connector.package && <Check size={14} className="connector-check" aria-label="Default" />}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
