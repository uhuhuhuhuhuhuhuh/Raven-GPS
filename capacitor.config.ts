import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.uhuhuhuhuhuhuhuh.ravengps',
  appName: 'Raven GPS',
  webDir: 'dist',
  // The public routing and geocoding services ask clients to identify themselves.
  appendUserAgent: 'RavenGPS/1.0 (+https://github.com/uhuhuhuhuhuhuhuh/Raven-GPS)',
  backgroundColor: '#0a0e15',
  android: {
    allowMixedContent: false
  }
};

export default config;
