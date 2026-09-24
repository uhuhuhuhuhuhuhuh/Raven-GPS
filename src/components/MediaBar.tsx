import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { connectorFor } from '../lib/media';
import type { MediaAction, NowPlaying } from '../lib/native';

type Props = {
  nowPlaying: NowPlaying | null;
  preferred: string | null;
  onControl: (action: MediaAction) => void;
  onOpenConnectors: () => void;
  compact?: boolean;
};

/** Mini player: what's playing in Spotify, Plexamp, YouTube Music…, with controls. */
export function MediaBar({ nowPlaying, preferred, onControl, onOpenConnectors, compact }: Props) {
  const app = connectorFor(nowPlaying?.package) ?? connectorFor(preferred);
  const title = nowPlaying?.title || (app ? `Play ${app.name}` : 'Music');
  const subtitle = nowPlaying ? [nowPlaying.artist, nowPlaying.appName].filter(Boolean).join(' · ') : 'Tap to connect a music app';
  return (
    <div className={`media-bar${compact ? ' compact' : ''}`} data-testid="media-bar">
      <button className="media-info" onClick={onOpenConnectors} aria-label="Music and audio apps">
        <span className="media-art" style={{ borderColor: app?.color ?? 'var(--line)' }}>
          {nowPlaying?.artwork ? <img src={nowPlaying.artwork} alt="" /> : <Music size={18} aria-hidden />}
        </span>
        <span className="media-text">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
      </button>
      <div className="media-controls">
        <button onClick={() => onControl('previous')} aria-label="Previous track"><SkipBack size={20} /></button>
        <button className="media-play" onClick={() => onControl('toggle')} aria-label={nowPlaying?.playing ? 'Pause' : 'Play'}>
          {nowPlaying?.playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button onClick={() => onControl('next')} aria-label="Next track"><SkipForward size={20} /></button>
      </div>
    </div>
  );
}
