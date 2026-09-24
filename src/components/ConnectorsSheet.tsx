import { Check, ExternalLink, ListMusic, ShieldCheck } from 'lucide-react';
import { CONNECTORS, SPOTIFY_PACKAGE, type Connector } from '../lib/media';
import { Sheet } from './Sheet';

type Props = {
  native: boolean;
  granted: boolean;
  installed: string[];
  preferred: string | null;
  onGrant: () => void;
  onLaunch: (packageName: string, web: string) => void;
  onBrowse: (connector: Connector) => void;
  onPrefer: (packageName: string) => void;
  onClose: () => void;
};

export function ConnectorsSheet({ native, granted, installed, preferred, onGrant, onLaunch, onBrowse, onPrefer, onClose }: Props) {
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
      {native && granted && <p className="note">Tap an installed app to browse its playlists and play one here.</p>}
      <ul className="connector-grid">
        {sorted.map(connector => {
          const isInstalled = installed.includes(connector.package);
          // Spotify goes through App Remote, which doesn't need notification access.
          const canBrowse = native && isInstalled && (granted || connector.package === SPOTIFY_PACKAGE);
          return (
            <li key={connector.id}>
              <button
                className={`connector${preferred === connector.package ? ' preferred' : ''}`}
                onClick={() => { onPrefer(connector.package); if (canBrowse) onBrowse(connector); else onLaunch(connector.package, connector.web); }}
              >
                <span className="connector-badge" style={{ background: connector.color }}>{connector.name[0]}</span>
                <span className="connector-name">{connector.name}</span>
                {native && <small>{canBrowse ? <><ListMusic size={12} /> Browse</> : isInstalled ? 'Open' : 'Get app'}</small>}
                {preferred === connector.package && <Check size={14} className="connector-check" aria-label="Default" />}
              </button>
              {canBrowse && (
                <button className="connector-open" onClick={() => onLaunch(connector.package, connector.web)} aria-label={`Open ${connector.name}`}>
                  <ExternalLink size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
