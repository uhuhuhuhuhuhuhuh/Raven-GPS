import { ChevronLeft, ListMusic, LoaderCircle, Music, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Connector } from '../lib/media';
import type { MediaBrowseItem } from '../lib/native';
import { Sheet } from './Sheet';

type Crumb = { id: string | undefined; title: string };

type Props = {
  connector: Connector;
  browse: (packageName: string, parentId?: string) => Promise<MediaBrowseItem[]>;
  play: (packageName: string, mediaId: string) => Promise<void>;
  onClose: () => void;
};

/** Waze-style in-app library browser: drill into a music app's playlists and play one. */
export function MediaBrowseSheet({ connector, browse, play, onClose }: Props) {
  const [stack, setStack] = useState<Crumb[]>([{ id: undefined, title: 'Library' }]);
  const [items, setItems] = useState<MediaBrowseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const current = stack[stack.length - 1];

  const load = useCallback(async (parentId: string | undefined) => {
    setLoading(true);
    setError(null);
    try {
      const result = await browse(connector.package, parentId);
      setItems(result);
      if (result.length === 0) setError(`${connector.name} didn't share anything here. Open the app and sign in, then try again.`);
    } catch (problem) {
      setItems([]);
      setError(problem instanceof Error ? problem.message : "Couldn't read this app's library.");
    } finally {
      setLoading(false);
    }
  }, [browse, connector]);

  useEffect(() => { void load(current.id); }, [load, current.id]);

  const onItem = async (item: MediaBrowseItem) => {
    if (item.playable) {
      setPlaying(item.id);
      try {
        await play(connector.package, item.id);
        onClose();
      } catch {
        setPlaying(null);
      }
      return;
    }
    if (item.browsable) setStack(previous => [...previous, { id: item.id, title: item.title || 'Folder' }]);
  };

  const back = () => setStack(previous => (previous.length > 1 ? previous.slice(0, -1) : previous));

  return (
    <Sheet title={`Browse ${connector.name}`} onClose={onClose} className="browse-sheet">
      <div className="browse-path">
        {stack.length > 1 && <button className="icon-button" onClick={back} aria-label="Back"><ChevronLeft size={20} /></button>}
        <span className="browse-crumb">{stack.map(crumb => crumb.title).join(' › ')}</span>
      </div>
      {loading ? (
        <p className="note"><LoaderCircle size={16} className="spin" /> Loading…</p>
      ) : error ? (
        <p className="note warn">{error}</p>
      ) : (
        <ul className="browse-list">
          {items.map((item, index) => (
            <li key={item.id || `${item.title}-${index}`}>
              <button className="browse-item" onClick={() => void onItem(item)} disabled={playing === item.id}>
                <span className="browse-icon" style={{ borderColor: connector.color }}>
                  {item.playable && !item.browsable ? <Music size={18} aria-hidden /> : <ListMusic size={18} aria-hidden />}
                </span>
                <span className="browse-labels">
                  <strong>{item.title || 'Untitled'}</strong>
                  {item.subtitle && <small>{item.subtitle}</small>}
                </span>
                {item.playable && <Play size={16} className="browse-play" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
