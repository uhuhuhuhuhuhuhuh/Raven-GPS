import { Capacitor, WebPlugin, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * RavenNative is this app's own Android plugin (android/app/src/main/java/.../RavenNativePlugin.java):
 * navigation voice that ducks music, keeping the screen on, and the media connectors
 * (now playing + transport controls for Spotify, Plexamp, YouTube Music and any other
 * player, and launching those apps). In a browser a reduced web version is used.
 */
export type NowPlaying = {
  package: string;
  appName: string;
  title: string;
  artist: string;
  album: string;
  /** data: URL of the cover art, when the player shares one. */
  artwork: string | null;
  playing: boolean;
};

export type MediaAction = 'play' | 'pause' | 'toggle' | 'next' | 'previous';

/** One entry in a music app's browse tree (a playlist/album/folder, or a track). */
export type MediaBrowseItem = {
  /** Opaque media id from the source app; pass back to mediaBrowse or mediaPlayId. */
  id: string;
  title: string;
  subtitle: string;
  /** Can be opened to reveal children (a playlist, album or folder). */
  browsable: boolean;
  /** Can be played directly (a track, or a playable playlist). */
  playable: boolean;
  /** content:// or http(s):// icon URI, when the app provides one. */
  icon: string | null;
};

export interface RavenNativePlugin {
  speak(options: { text: string; rate?: number; language?: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
  mediaAccess(): Promise<{ granted: boolean }>;
  openMediaAccessSettings(): Promise<void>;
  nowPlaying(): Promise<{ playing?: NowPlaying }>;
  mediaControl(options: { action: MediaAction }): Promise<void>;
  /** Browse a music app's library. Omit parentId for the top level. */
  mediaBrowse(options: { package: string; parentId?: string }): Promise<{ items: MediaBrowseItem[] }>;
  /** Start playback of a browsed item in its source app. */
  mediaPlayId(options: { package: string; mediaId: string }): Promise<void>;
  /** Spotify refuses generic MediaBrowser clients, so it goes through App Remote instead. */
  spotifyBrowse(options: { clientId: string; parentId?: string }): Promise<{ items: MediaBrowseItem[] }>;
  spotifyPlay(options: { clientId: string; id: string }): Promise<void>;
  /** One-time consent flow; App Remote refuses to connect until this has been completed. */
  spotifyAuthorize(options: { clientId: string }): Promise<void>;
  /** Which of these are installed, plus each one's launcher icon as a data URL. */
  installedApps(options: { packages: string[] }): Promise<{ installed: string[]; icons: Record<string, string> }>;
  launchApp(options: { package: string; web?: string }): Promise<{ launched: boolean }>;
  /** Installed app version, for the in-app updater. */
  appInfo(): Promise<{ versionCode: number; versionName: string }>;
  /** Download an APK and hand it to the system installer. */
  downloadAndInstall(options: { url: string }): Promise<{ started: boolean }>;
  addListener(event: 'nowPlaying', listener: (info: { playing?: NowPlaying }) => void): Promise<PluginListenerHandle>;
}

class RavenNativeWeb extends WebPlugin implements RavenNativePlugin {
  private wakeLock: { release(): Promise<void> } | null = null;

  async speak(options: { text: string; rate?: number; language?: string }): Promise<void> {
    if (typeof speechSynthesis === 'undefined') return;
    await new Promise<void>(resolve => {
      const utterance = new SpeechSynthesisUtterance(options.text);
      utterance.rate = options.rate ?? 1;
      if (options.language) utterance.lang = options.language;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
      // Some browsers never fire onend when speech is unavailable.
      setTimeout(resolve, 2000 + options.text.length * 90);
    });
  }

  async stopSpeaking(): Promise<void> {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  async setKeepAwake(options: { enabled: boolean }): Promise<void> {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (options.enabled && wakeLock && !this.wakeLock) this.wakeLock = await wakeLock.request('screen').catch(() => null);
    if (!options.enabled && this.wakeLock) {
      await this.wakeLock.release().catch(() => undefined);
      this.wakeLock = null;
    }
  }

  async mediaAccess() {
    return { granted: false };
  }

  async openMediaAccessSettings(): Promise<void> {}

  async nowPlaying() {
    return {};
  }

  async mediaControl(): Promise<void> {}

  async mediaBrowse() {
    return { items: [] };
  }

  async mediaPlayId(): Promise<void> {}

  async spotifyBrowse() {
    return { items: [] };
  }

  async spotifyPlay(): Promise<void> {}

  async spotifyAuthorize(): Promise<void> {}

  async installedApps() {
    return { installed: [], icons: {} };
  }

  async launchApp(options: { package: string; web?: string }) {
    if (options.web) window.open(options.web, '_blank', 'noopener');
    return { launched: Boolean(options.web) };
  }

  async appInfo() {
    return { versionCode: 0, versionName: 'web' };
  }

  async downloadAndInstall(options: { url: string }) {
    window.open(options.url, '_blank', 'noopener');
    return { started: false };
  }
}

export const RavenNative = registerPlugin<RavenNativePlugin>('RavenNative', { web: () => new RavenNativeWeb() });

export const isNative = () => Capacitor.isNativePlatform();
