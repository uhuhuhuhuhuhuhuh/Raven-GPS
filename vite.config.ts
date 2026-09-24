import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs work both inside the Android app and under a GitHub Pages subpath.
  base: './',
  build: {
    chunkSizeWarningLimit: 1100,
    // Old phones: Android System WebView 87+ (late 2020), for devices that stopped updating.
    target: ['chrome87', 'es2020'],
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ['maplibre-gl'] }
      }
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
