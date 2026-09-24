# Raven GPS

Turn-by-turn navigation for Android that routes around **Flock Safety** devices and
**every other license plate reader** mapped in OpenStreetMap, like Waze but for privacy.

**Download:** the latest APK is on the [Releases page](../../releases): open
`raven-gps.apk` on your phone and allow installing from that source.

## What it does

- **Camera-avoiding routes.** Pick what to avoid: Flock Safety devices, all plate readers
  (ALPR: Flock, Motorola/Vigilant, Genetec, Rekor…), and optionally speed and red-light
  cameras. Avoidance can be turned off entirely; cameras are then still shown and announced.
- **Route choices.** For every trip you get:
  - **Fastest**: the quickest drive passing the fewest cameras found.
  - **In-between**: fewer highways, a middle ground on time.
  - **Less traffic**: stays off the highways and expressways where congestion builds, and
    takes longer. There is no free live-traffic feed, so this uses road type, not live data.
  - **Alternatives** the router suggests.
  - **Direct**: ignores cameras, for comparison.

  Each option shows its drive time, distance and how many cameras it still passes.
- **Turn-by-turn guidance** with voice (music ducks while it speaks), lane-style banners,
  exit numbers, ETA, speed, automatic rerouting when you leave the route, and alerts before
  any camera that couldn't be avoided.
- **Music connectors.** A player bar shows what's playing and controls **Spotify, Plexamp,
  Plex, YouTube Music, Apple Music, Amazon Music, Pandora, TIDAL, Deezer, SoundCloud,
  iHeartRadio, TuneIn, Audible and Pocket Casts**, and opens them. It uses Android's media
  sessions, so it needs no accounts or API keys: grant "notification access" once when asked.
- Search as you type, long-press the map to drive anywhere, Home/Work and recent places,
  share your ETA, and a **Preview drive** mode that simulates the trip.

## How avoidance works

Camera positions come from OpenStreetMap (mapped largely by [DeFlock](https://deflock.me)
volunteers). Inside the US they are read from the static tiles that
[Raven](https://github.com/uhuhuhuhuhuhuhuh/Raven) publishes on GitHub Pages; elsewhere
they come from the Overpass API. Routes come from Valhalla on the FOSSGIS public server.

1. Ask for the normal route and list the cameras it passes. A camera counts only if the
   route runs along its mapped line of sight within the chosen distance (35 m by default).
   Crossing its street at an intersection doesn't count.
2. Exclude the road at each of those cameras and ask again, while that keeps lowering the
   count. (In dense areas a wholesale detour can land on streets with more cameras; then
   this phase stops.)
3. From the best route so far, detour around one camera site at a time, keeping each
   detour that helps.
4. Every route the router returns, alternates included, is a candidate. The option shown
   passes the fewest cameras, then takes the least time, capped at twice the normal time.

Cameras at your start or destination can't be avoided and are announced instead. Only
mapped cameras can be avoided: help by adding missing ones at [deflock.me](https://deflock.me).

## Development

```bash
npm install
npm run dev          # web version at http://localhost:5173
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright, network mocked)
npm run lint
npm run android:apk  # needs JDK 21 and the Android SDK (ANDROID_HOME)
```

The app is React + TypeScript + MapLibre, wrapped with Capacitor. Native code lives in
`android/app/src/main/java/.../RavenNativePlugin.java`: voice with audio ducking,
keep-screen-on, and the media connectors.

### Releases and signing

`.github/workflows/android.yml` tests everything, builds the APK and publishes it:
- Pushes to `main` publish the `latest` release.
- `v*` tags publish versioned releases.
- Other branches publish a `preview` pre-release.

Without a signing key the APK is signed with a CI-cached debug key. For a stable release
key, add these repository secrets:
- `ANDROID_KEYSTORE_BASE64` (the keystore, base64-encoded)
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## Services and credits

- Routing: [Valhalla](https://github.com/valhalla/valhalla) on the FOSSGIS servers. Their
  policy allows at most 1 request per second, which the app enforces. A different server
  can be set in Settings.
- Search: [Photon](https://photon.komoot.io) by komoot.
- Map: [OpenFreeMap](https://openfreemap.org).
- Data: © OpenStreetMap contributors, ODbL.

Raven GPS uses public map data only. It doesn't contact, probe or interfere with any camera.
