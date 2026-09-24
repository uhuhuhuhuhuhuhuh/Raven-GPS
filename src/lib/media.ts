/**
 * Music and audio "connectors". On Android, Raven GPS reads what is playing and sends
 * play/pause/skip through the system's media sessions, which every one of these apps
 * publishes. That works with any player, with no accounts or API keys. Listed apps can
 * also be opened straight from the player bar.
 */
export type Connector = {
  id: string;
  name: string;
  /** Android package name. */
  package: string;
  /** Web player, used outside the Android app. */
  web: string;
  color: string;
};

export const CONNECTORS: Connector[] = [
  { id: 'spotify', name: 'Spotify', package: 'com.spotify.music', web: 'https://open.spotify.com', color: '#1ed760' },
  { id: 'plexamp', name: 'Plexamp', package: 'tv.plex.labs.plexamp', web: 'https://listen.plex.tv', color: '#ebaf00' },
  { id: 'plex', name: 'Plex', package: 'com.plexapp.android', web: 'https://app.plex.tv', color: '#e5a00d' },
  { id: 'youtube-music', name: 'YouTube Music', package: 'com.google.android.apps.youtube.music', web: 'https://music.youtube.com', color: '#ff3b30' },
  { id: 'apple-music', name: 'Apple Music', package: 'com.apple.android.music', web: 'https://music.apple.com', color: '#fa4d63' },
  { id: 'amazon-music', name: 'Amazon Music', package: 'com.amazon.mp3', web: 'https://music.amazon.com', color: '#3fd4de' },
  { id: 'pandora', name: 'Pandora', package: 'com.pandora.android', web: 'https://www.pandora.com', color: '#5c7cff' },
  { id: 'tidal', name: 'TIDAL', package: 'com.aspiro.tidal', web: 'https://listen.tidal.com', color: '#e8eaf0' },
  { id: 'deezer', name: 'Deezer', package: 'deezer.android.app', web: 'https://www.deezer.com', color: '#b061ff' },
  { id: 'soundcloud', name: 'SoundCloud', package: 'com.soundcloud.android', web: 'https://soundcloud.com', color: '#ff6a1a' },
  { id: 'iheartradio', name: 'iHeartRadio', package: 'com.clearchannel.iheartradio.controller', web: 'https://www.iheart.com', color: '#ff4d6d' },
  { id: 'tunein', name: 'TuneIn', package: 'tunein.player', web: 'https://tunein.com', color: '#35d0ba' },
  { id: 'audible', name: 'Audible', package: 'com.audible.application', web: 'https://www.audible.com', color: '#f8a532' },
  { id: 'pocket-casts', name: 'Pocket Casts', package: 'au.com.shiftyjelly.pocketcasts', web: 'https://play.pocketcasts.com', color: '#f4524d' }
];

export function connectorFor(packageName: string | null | undefined): Connector | undefined {
  return CONNECTORS.find(connector => connector.package === packageName);
}
