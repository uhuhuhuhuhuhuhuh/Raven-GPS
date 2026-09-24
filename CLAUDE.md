# Raven GPS: handoff for a local Claude Code session

You are on a computer with an Android phone connected over `adb`. The job: install Raven
GPS on the phone, test it there, fix what breaks, and push the fixes. The app was built in
a cloud session without a device, so nothing here has run on real hardware yet.

**The app:** Android navigation (React + TypeScript + MapLibre, wrapped with Capacitor 8)
that routes around Flock Safety devices and license plate readers mapped in
OpenStreetMap. It offers fastest / in-between / less-traffic / direct route options, and a
music player bar for Spotify, Plexamp, Plex and others. README.md has the full picture.

**Work on branch `claude/sleepy-archimedes-t2xsch`.** Every push there makes CI publish a
fresh APK at https://github.com/uhuhuhuhuhuhuhuh/Raven-GPS/releases/tag/preview
(about 5 minutes).

## 1. Check the phone

The test phone is likely **old and has no GPS**. Check these first:

```bash
adb devices                                          # must say "device", not "unauthorized"
adb shell getprop ro.build.version.sdk               # needs 24+ (Android 7.0)
adb shell dumpsys webviewupdate | grep -i "current webview"   # needs version 87+
adb shell pm list features | grep -i location        # android.hardware.location.gps present?
adb shell pm list packages | grep -iE "tts|com.google.android.gms"   # speech engine, Play services
```

- **SDK below 24:** the APK won't install; the phone can't be used.
- **WebView below 87:** update "Android System WebView" from the Play Store (on Android 7–9,
  update Chrome, which provides the WebView there). Otherwise the app shows a blank screen.
- **No speech engine:** voice guidance is silent. Install Google Text-to-Speech.

## 2. Install

```bash
# Quick: the CI build
curl -L -o raven-gps.apk https://github.com/uhuhuhuhuhuhuhuh/Raven-GPS/releases/download/preview/raven-gps.apk
adb install -r raven-gps.apk

# From source: a debug build, which you can inspect in Chrome.
# Needs JDK 21, the Android SDK (ANDROID_HOME) and npm ci.
npm ci && npm run build && npx cap sync android
(cd android && ./gradlew installDebug)

adb shell pm grant io.github.uhuhuhuhuhuhuhuh.ravengps android.permission.ACCESS_FINE_LOCATION
adb shell monkey -p io.github.uhuhuhuhuhuhuhuh.ravengps -c android.intent.category.LAUNCHER 1
```

The CI build and a local build are signed with different keys. Before switching between
them, run `adb uninstall io.github.uhuhuhuhuhuhuhuh.ravengps`; this also clears the app's
settings.

## 3. Test (in this order)

Without GPS, the app starts routes from the middle of the map and says so. **Preview
drive** (in the route panel) simulates the whole trip, so it covers everything except real
positioning.

1. **Launch:** splash screen, then the dark map. Nothing is hidden under the status bar or
   gesture bar. The chip reads "Avoiding Flock devices and all plate readers".
2. **Map:** zoom into a US city (Atlanta is dense). Camera markers appear from zoom 10.
3. **Search:** type a place and pick it. Route options stream in over 5–20 seconds; the
   routing server allows 1 request per second. Each option shows time, distance and a
   camera count.
4. **Preview drive:** the turn banner updates, voice speaks, and ETA and distance count down.
   - Choose the **Direct** option to hear and see a camera alert.
   - Fast-forward is the ⏩ button.
5. **Settings:**
   - Turn "Avoid cameras" off, then re-plan: there's no Direct option, and counts are only shown.
   - Try the Flock / all plate readers / speed camera switches.
   - Try miles/km and the voice mute.
6. **Music:** tap the player bar → "Allow access" (notification access). Then play something
   in Spotify or Plexamp:
   - The bar shows title, artist and cover art.
   - Play/pause/skip work.
   - Voice guidance ducks the music.
   - Tapping a connector opens the app, or the Play Store if it isn't installed.
7. **Screen:** stays on while navigating; ending navigation releases it.

Real-position checks (following the map, rerouting after a wrong turn) need location input:
- **Wi-Fi location:** coarse, with no speed or heading.
- **A mock-location app** (e.g. Lockito), set in Developer options → "Select mock location app".
- **Android 12 and later only:** you can try
  `adb shell appops set com.android.shell android:mock_location allow`, then
  `adb shell cmd location providers add-test-provider gps` and
  `adb shell cmd location providers set-test-provider-location gps --location 33.7489,-84.3879`.
  This is untested.

## 4. Debugging

```bash
adb logcat -v time | grep -iE "Capacitor|RavenNative|chromium|AndroidRuntime"
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png
```

- **Debug build:** open `chrome://inspect` on the computer to use DevTools on the app's
  WebView: console errors, network and the element tree.
- **Blank white or black screen:** almost always an old WebView (step 1) or a JavaScript
  error; check logcat for `chromium` lines.

## 5. Fixing and shipping

- **Before pushing:** `npm run lint && npm test && npm run build && npm run test:e2e`.
  After Android changes, also run `cd android && ./gradlew assembleDebug`.
- **Push** to `claude/sleepy-archimedes-t2xsch`, then reinstall from the preview release to confirm.
- **Commit messages:** say what changed on the device and why.

## Code map

- `src/lib/`: engine, no UI.
  - `planner.ts`: avoidance search.
  - `cameras.ts`: classification and spatial index.
  - `cameraData.ts`: Raven tiles, Overpass fallback, cache.
  - `valhalla.ts`: routing client, 1 req/s queue.
  - `navigation.ts`: progress, voice cues, off-route.
  - `native.ts`: bridge to the Android plugin.
  - `signals.ts`: fallbacks for old WebViews.
- `src/App.tsx` and `src/components/`: UI. `src/map/`: basemap and camera marker images.
- `android/app/src/main/java/io/github/uhuhuhuhuhuhuhuh/ravengps/RavenNativePlugin.java`:
  - Voice with audio ducking, and keep-screen-on.
  - Media connectors: MediaSession now-playing and controls, app launching.
  - `MediaListenerService` exists only so notification access can be granted.
- Connector packages are listed in both `src/lib/media.ts` and the manifest `<queries>`. A
  unit test keeps them in sync.

## Known gaps

- No background location or foreground service: guidance pauses when the screen is locked.
- "Less traffic" uses road types, not live traffic; there is no free live-traffic feed.
- Only cameras mapped in OpenStreetMap can be avoided.
