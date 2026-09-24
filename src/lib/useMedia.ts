import { useCallback, useEffect, useState } from 'react';
import { CONNECTORS } from './media';
import { RavenNative, isNative, type MediaAction, type NowPlaying } from './native';

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

  const grant = useCallback(() => {
    void RavenNative.openMediaAccessSettings().catch(() => undefined);
  }, []);

  return { native, granted, nowPlaying, installed, control, launch, grant, refresh };
}
