import { useCallback, useEffect, useState } from 'react';
import { CONNECTORS, SPOTIFY_CLIENT_ID, SPOTIFY_PACKAGE } from './media';
import { RavenNative, isNative, type MediaAction, type MediaBrowseItem, type NowPlaying } from './native';

/** Media connector state: access, installed players and what's playing now. */
export function useMedia() {
  const native = isNative();
  const [granted, setGranted] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!native) return;
    try {
      const access = await RavenNative.mediaAccess();
      setGranted(access.granted);
      if (access.granted) setNowPlaying((await RavenNative.nowPlaying()).playing ?? null);
      setInstalled((await RavenNative.installedApps({ packages: CONNECTORS.map(connector => connector.package) })).installed);
    } catch {
      // plugin unavailable: the bar stays in its "connect" state
    }
  }, [native]);

  useEffect(() => {
    if (!native) return;
    void refresh();
    const handle = RavenNative.addListener('nowPlaying', info => setNowPlaying(info.playing ?? null));
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      void handle.then(listener => listener.remove());
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [native, refresh]);

  const control = useCallback((action: MediaAction) => {
    void RavenNative.mediaControl({ action }).catch(() => undefined);
    if (nowPlaying && (action === 'toggle' || action === 'play' || action === 'pause')) {
      setNowPlaying({ ...nowPlaying, playing: action === 'toggle' ? !nowPlaying.playing : action === 'play' });
    }
  }, [nowPlaying]);

  const launch = useCallback((packageName: string, web: string) => {
    void RavenNative.launchApp({ package: packageName, web }).catch(() => undefined);
  }, []);

  const browse = useCallback(async (packageName: string, parentId?: string): Promise<MediaBrowseItem[]> => {
    if (!native) return [];
    if (packageName === SPOTIFY_PACKAGE) {
      return (await RavenNative.spotifyBrowse({ clientId: SPOTIFY_CLIENT_ID, parentId })).items;
    }
    return (await RavenNative.mediaBrowse({ package: packageName, parentId })).items;
  }, [native]);

  const play = useCallback(async (packageName: string, mediaId: string): Promise<void> => {
    if (packageName === SPOTIFY_PACKAGE) await RavenNative.spotifyPlay({ clientId: SPOTIFY_CLIENT_ID, id: mediaId });
    else await RavenNative.mediaPlayId({ package: packageName, mediaId });
    void refresh();
  }, [refresh]);

  const grant = useCallback(() => {
    void RavenNative.openMediaAccessSettings().catch(() => undefined);
  }, []);

  return { native, granted, nowPlaying, installed, control, launch, browse, play, grant, refresh };
}
