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

export interface RavenNativePlugin {
  speak(options: { text: string; rate?: number; language?: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
  mediaAccess(): Promise<{ granted: boolean }>;
  openMediaAccessSettings(): Promise<void>;
  nowPlaying(): Promise<{ playing?: NowPlaying }>;
  mediaControl(options: { action: MediaAction }): Promise<void>;
  installedApps(options: { packages: string[] }): Promise<{ installed: string[] }>;
  launchApp(options: { package: string; web?: string }): Promise<{ launched: boolean }>;
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

  async installedApps() {
    return { installed: [] };
  }

  async launchApp(options: { package: string; web?: string }) {
    if (options.web) window.open(options.web, '_blank', 'noopener');
    return { launched: Boolean(options.web) };
  }
}

export const RavenNative = registerPlugin<RavenNativePlugin>('RavenNative', { web: () => new RavenNativeWeb() });

export const isNative = () => Capacitor.isNativePlatform();
