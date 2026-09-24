# Raven GPS: notes for Claude Code sessions

Android navigation app (React + TypeScript + MapLibre, wrapped with Capacitor 8) that
routes around Flock Safety devices and license plate readers mapped in OpenStreetMap.
See README.md for features and how avoidance works.

## Layout

- `src/lib/`: engine, no UI.
  - `planner.ts`: avoidance search.
  - `cameras.ts`: classification and spatial index.
  - `cameraData.ts`: Raven tiles, Overpass fallback, IndexedDB cache.
  - `valhalla.ts`: routing client, 1 req/s queue.
  - `navigation.ts`: progress, voice cues, off-route.
  - `native.ts`: bridge to the Android plugin.
- `src/App.tsx` and `src/components/`: UI. `src/map/`: basemap and marker images.
- `android/app/src/main/java/io/github/uhuhuhuhuhuhuhuh/ravengps/RavenNativePlugin.java`: native side.
  - TTS with audio ducking, and keep-screen-on.
  - Media connectors: MediaSession now-playing and controls, app launching.
  - `MediaListenerService` exists only for the notification-access grant.
- Connector package names live in `src/lib/media.ts` and in the manifest `<queries>`. Keep
  them in sync; a unit test checks.

## Checks (run before pushing)

```bash
npm ci
npm run lint && npm test && npm run build
npm run test:e2e          # Playwright, network mocked
```

## Testing on a phone over adb

Needs JDK 21 and the Android SDK (`ANDROID_HOME`). `adb devices` must list the phone as `device`.

```bash
# Quick: install the CI build from the preview/latest GitHub release
adb install -r raven-gps.apk

# Debuggable build from source (WebView debugging is on only in debug builds)
npm run build && npx cap sync android
cd android && ./gradlew installDebug && cd ..
adb shell monkey -p io.github.uhuhuhuhuhuhuhuh.ravengps -c android.intent.category.LAUNCHER 1

# Logs: native plugin, Capacitor bridge, and web console messages
adb logcat -v time | grep -iE "Capacitor|RavenNative|chromium|AndroidRuntime"

# Web inspector for the app's WebView: open chrome://inspect on the computer
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png   # screenshot
```

A CI build and a local build are signed with different debug keys. Switching between them
needs `adb uninstall io.github.uhuhuhuhuhuhuhuh.ravengps` first. That also clears saved
places and settings.

Useful adb shortcuts while testing:
- Grant location without tapping:
  `adb shell pm grant io.github.uhuhuhuhuhuhuhuh.ravengps android.permission.ACCESS_FINE_LOCATION`
- Open the notification-access screen (music connectors):
  `adb shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`
- Media key, to check the player bar follows Spotify, Plexamp and others:
  `adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE`

## What still needs checking on a real device

These have only been verified by build and APK inspection. No emulator was available in
the cloud session.

1. Launch, the splash screen, and safe-area insets: nothing hidden under the status bar or
   gesture bar.
2. Location permission prompt, then the map follows GPS.
3. Search → route options appear. Time the planner against the FOSSGIS 1 req/s limit.
4. "Preview drive": voice guidance speaks, and music ducks while it does.
5. Camera alert pill and voice for a route that passes a camera (pick the "Direct" option).
6. Music connectors:
   - Grant notification access.
   - Play something in Spotify or Plexamp; the player bar shows title, artist and art.
   - Play/pause/skip work.
   - Tapping a connector opens the app, or the Play Store if it isn't installed.
7. Keep-screen-on during navigation, and ending navigation releases it.
8. Rerouting after deliberately leaving the route on a real drive.

Known gap: there is no background location or foreground service yet, so guidance pauses
when the screen is locked.
