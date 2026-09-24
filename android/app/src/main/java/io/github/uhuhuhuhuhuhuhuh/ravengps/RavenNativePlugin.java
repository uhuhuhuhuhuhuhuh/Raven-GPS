package io.github.uhuhuhuhuhuhuhuh.ravengps;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaDescription;
import android.media.MediaMetadata;
import android.media.browse.MediaBrowser;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.spotify.sdk.android.auth.AuthorizationClient;
import com.spotify.sdk.android.auth.AuthorizationRequest;
import com.spotify.sdk.android.auth.AuthorizationResponse;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Native side of Raven GPS: spoken guidance that ducks music, keeping the screen on while
 * navigating, and the media connectors (now playing + transport controls for any player
 * through Android media sessions, and launching music apps).
 */
@CapacitorPlugin(name = "RavenNative")
public class RavenNativePlugin extends Plugin {
    private static final int TTS_NONE = 0;
    private static final int TTS_STARTING = 1;
    private static final int TTS_READY = 2;
    private static final int TTS_FAILED = 3;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, PluginCall> pendingSpeech = new HashMap<>();
    private final List<Runnable> afterTtsInit = new ArrayList<>();
    private TextToSpeech tts;
    private int ttsState = TTS_NONE;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;

    private MediaSessionManager sessionManager;
    private MediaSessionManager.OnActiveSessionsChangedListener sessionsListener;
    private MediaController controller;
    private String artworkKey = null;
    private String artworkData = null;
    private final MediaController.Callback controllerCallback = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            publish();
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            publish();
        }

        @Override
        public void onSessionDestroyed() {
            selectController();
        }
    };

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        sessionManager = (MediaSessionManager) getContext().getSystemService(Context.MEDIA_SESSION_SERVICE);
        startMediaWatch();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // The user may have just granted notification access in system settings.
        startMediaWatch();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
        if (spotify != null) spotify.release();
        if (sessionManager != null && sessionsListener != null) sessionManager.removeOnActiveSessionsChangedListener(sessionsListener);
        if (controller != null) controller.unregisterCallback(controllerCallback);
        super.handleOnDestroy();
    }

    // ---- Voice guidance ---------------------------------------------------------------

    private static AudioAttributes guidanceAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private synchronized void withTts(Runnable action) {
        if (ttsState == TTS_READY || ttsState == TTS_FAILED) {
            action.run();
            return;
        }
        afterTtsInit.add(action);
        if (ttsState == TTS_STARTING) return;
        ttsState = TTS_STARTING;
        tts = new TextToSpeech(getContext(), status -> {
            List<Runnable> queued;
            synchronized (RavenNativePlugin.this) {
                ttsState = status == TextToSpeech.SUCCESS ? TTS_READY : TTS_FAILED;
                if (ttsState == TTS_READY) {
                    tts.setAudioAttributes(guidanceAttributes());
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String id) {}

                        @Override
                        public void onDone(String id) {
                            finishUtterance(id);
                        }

                        @Override
                        @SuppressWarnings("deprecation")
                        public void onError(String id) {
                            finishUtterance(id);
                        }

                        @Override
                        public void onStop(String id, boolean interrupted) {
                            finishUtterance(id);
                        }
                    });
                }
                queued = new ArrayList<>(afterTtsInit);
                afterTtsInit.clear();
            }
            for (Runnable runnable : queued) runnable.run();
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        float rate = call.getFloat("rate", 1.0f);
        String language = call.getString("language");
        if (text == null || text.isEmpty()) {
            call.resolve();
            return;
        }
        withTts(() -> {
            if (ttsState != TTS_READY) {
                call.resolve();
                return;
            }
            if (language != null) tts.setLanguage(Locale.forLanguageTag(language));
            tts.setSpeechRate(rate);
            String id = UUID.randomUUID().toString();
            synchronized (this) {
                if (pendingSpeech.isEmpty()) requestFocus();
                pendingSpeech.put(id, call);
            }
            if (tts.speak(text, TextToSpeech.QUEUE_ADD, new Bundle(), id) == TextToSpeech.ERROR) finishUtterance(id);
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        List<PluginCall> calls;
        synchronized (this) {
            calls = new ArrayList<>(pendingSpeech.values());
            pendingSpeech.clear();
            abandonFocus();
        }
        for (PluginCall pending : calls) pending.resolve();
        call.resolve();
    }

    private void finishUtterance(String id) {
        PluginCall call;
        synchronized (this) {
            call = pendingSpeech.remove(id);
            if (pendingSpeech.isEmpty()) abandonFocus();
        }
        if (call != null) call.resolve();
    }

    /** Ask other apps (music) to lower their volume while guidance plays. */
    @SuppressWarnings("deprecation")
    private void requestFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(guidanceAttributes()).build();
            audioManager.requestAudioFocus(focusRequest);
        } else {
            audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
    }

    @SuppressWarnings("deprecation")
    private void abandonFocus() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audioManager.abandonAudioFocus(null);
        }
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // ---- Media connectors -------------------------------------------------------------

    private boolean hasMediaAccess() {
        return NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName());
    }

    private ComponentName listenerComponent() {
        return new ComponentName(getContext(), MediaListenerService.class);
    }

    private void startMediaWatch() {
        if (sessionManager == null || !hasMediaAccess()) return;
        try {
            if (sessionsListener == null) {
                sessionsListener = controllers -> selectController();
                sessionManager.addOnActiveSessionsChangedListener(sessionsListener, listenerComponent(), main);
            }
            selectController();
        } catch (SecurityException ignored) {
            sessionsListener = null;
        }
    }

    /** Follows the session that is playing (or the most recent one). */
    private void selectController() {
        MediaController chosen = null;
        try {
            List<MediaController> controllers = sessionManager.getActiveSessions(listenerComponent());
            for (MediaController candidate : controllers) {
                PlaybackState state = candidate.getPlaybackState();
                if (state != null && state.getState() == PlaybackState.STATE_PLAYING) {
                    chosen = candidate;
                    break;
                }
            }
            if (chosen == null && !controllers.isEmpty()) chosen = controllers.get(0);
        } catch (SecurityException ignored) {
            // access was revoked
        }
        boolean same = controller != null && chosen != null && controller.getSessionToken().equals(chosen.getSessionToken());
        if (!same) {
            if (controller != null) controller.unregisterCallback(controllerCallback);
            controller = chosen;
            if (controller != null) controller.registerCallback(controllerCallback, main);
        }
        publish();
    }

    private void publish() {
        notifyListeners("nowPlaying", describe());
    }

    private JSObject describe() {
        JSObject result = new JSObject();
        MediaController current = controller;
        if (current == null) return result;
        MediaMetadata metadata = current.getMetadata();
        PlaybackState state = current.getPlaybackState();
        JSObject playing = new JSObject();
        String packageName = current.getPackageName();
        playing.put("package", packageName);
        playing.put("appName", appLabel(packageName));
        playing.put("title", text(metadata, MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE));
        playing.put("artist", text(metadata, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_ALBUM_ARTIST, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE));
        playing.put("album", text(metadata, MediaMetadata.METADATA_KEY_ALBUM));
        playing.put("artwork", artwork(metadata));
        int code = state == null ? PlaybackState.STATE_NONE : state.getState();
        playing.put("playing", code == PlaybackState.STATE_PLAYING || code == PlaybackState.STATE_BUFFERING);
        result.put("playing", playing);
        return result;
    }

    private static String text(MediaMetadata metadata, String... keys) {
        if (metadata == null) return "";
        for (String key : keys) {
            CharSequence value = metadata.getText(key);
            if (value != null && value.length() > 0) return value.toString();
        }
        return "";
    }

    private String appLabel(String packageName) {
        try {
            PackageManager manager = getContext().getPackageManager();
            return manager.getApplicationLabel(manager.getApplicationInfo(packageName, 0)).toString();
        } catch (PackageManager.NameNotFoundException error) {
            return packageName;
        }
    }

    /** Small JPEG data URL of the cover art, re-encoded only when the track changes. */
    private Object artwork(MediaMetadata metadata) {
        if (metadata == null) return JSObject.NULL;
        String key = text(metadata, MediaMetadata.METADATA_KEY_TITLE) + "|" + text(metadata, MediaMetadata.METADATA_KEY_ARTIST) + "|" + text(metadata, MediaMetadata.METADATA_KEY_ALBUM);
        if (key.equals(artworkKey)) return artworkData == null ? JSObject.NULL : artworkData;
        Bitmap bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (bitmap == null) bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_ART);
        if (bitmap == null) bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
        artworkKey = key;
        artworkData = null;
        if (bitmap != null) {
            try {
                Bitmap scaled = Bitmap.createScaledBitmap(bitmap, 160, 160, true);
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, 80, output);
                artworkData = "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            } catch (RuntimeException ignored) {
                artworkData = null;
            }
        }
        return artworkData == null ? JSObject.NULL : artworkData;
    }

    @PluginMethod
    public void mediaAccess(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasMediaAccess());
        call.resolve(result);
    }

    @PluginMethod
    public void openMediaAccessSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            intent.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listenerComponent().flattenToString());
        } else {
            intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (RuntimeException error) {
            Intent fallback = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve();
    }

    @PluginMethod
    public void nowPlaying(PluginCall call) {
        if (hasMediaAccess()) startMediaWatch();
        call.resolve(describe());
    }

    @PluginMethod
    public void mediaControl(PluginCall call) {
        String action = call.getString("action", "toggle");
        MediaController current = controller;
        if (current != null) {
            MediaController.TransportControls controls = current.getTransportControls();
            PlaybackState state = current.getPlaybackState();
            boolean playing = state != null && state.getState() == PlaybackState.STATE_PLAYING;
            switch (action) {
                case "play": controls.play(); break;
                case "pause": controls.pause(); break;
                case "next": controls.skipToNext(); break;
                case "previous": controls.skipToPrevious(); break;
                default: if (playing) controls.pause(); else controls.play();
            }
        } else if (audioManager != null) {
            // Without notification access: a media key goes to whichever player is active.
            int code;
            switch (action) {
                case "play": code = KeyEvent.KEYCODE_MEDIA_PLAY; break;
                case "pause": code = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
                case "next": code = KeyEvent.KEYCODE_MEDIA_NEXT; break;
                case "previous": code = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
                default: code = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
            }
            audioManager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
            audioManager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
        }
        call.resolve();
    }

    @PluginMethod
    public void installedApps(PluginCall call) {
        JSArray requested = call.getArray("packages", new JSArray());
        JSArray installed = new JSArray();
        JSObject icons = new JSObject();
        PackageManager manager = getContext().getPackageManager();
        for (int index = 0; index < requested.length(); index++) {
            String packageName = requested.optString(index, "");
            if (packageName.isEmpty() || manager.getLaunchIntentForPackage(packageName) == null) continue;
            installed.put(packageName);
            String icon = appIcon(packageName);
            if (icon != null) icons.put(packageName, icon);
        }
        JSObject result = new JSObject();
        result.put("installed", installed);
        result.put("icons", icons);
        call.resolve(result);
    }

    /** The app's real launcher icon as a PNG data URL, so the picker can show it. */
    private String appIcon(String packageName) {
        try {
            Drawable drawable = getContext().getPackageManager().getApplicationIcon(packageName);
            int size = 96;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            // Draw rather than cast: modern icons are adaptive and have no single bitmap.
            drawable.setBounds(0, 0, size, size);
            drawable.draw(canvas);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
            return "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } catch (PackageManager.NameNotFoundException | RuntimeException error) {
            return null;
        }
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String packageName = call.getString("package", "");
        Intent launch = packageName.isEmpty() ? null : getContext().getPackageManager().getLaunchIntentForPackage(packageName);
        JSObject result = new JSObject();
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            result.put("launched", true);
        } else {
            Intent store = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(store);
            } catch (RuntimeException error) {
                getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
            result.put("launched", false);
        }
        call.resolve(result);
    }

    // ---- Library browsing (Waze-style in-app music picker) ----------------------------

    /** The MediaBrowserService a music app exposes for Android Auto / Assistant style browsing. */
    private ComponentName mediaBrowserComponent(String packageName) {
        Intent intent = new Intent("android.media.browse.MediaBrowserService");
        intent.setPackage(packageName);
        List<ResolveInfo> services = getContext().getPackageManager().queryIntentServices(intent, 0);
        if (services == null || services.isEmpty()) return null;
        ServiceInfo info = services.get(0).serviceInfo;
        return new ComponentName(info.packageName, info.name);
    }

    @PluginMethod
    public void mediaBrowse(PluginCall call) {
        String packageName = call.getString("package", "");
        String parentId = call.getString("parentId");
        if (packageName == null || packageName.isEmpty()) {
            call.reject("package required");
            return;
        }
        ComponentName component = mediaBrowserComponent(packageName);
        if (component == null) {
            call.reject("This app can't be browsed.");
            return;
        }
        main.post(() -> connectAndBrowse(call, component, parentId));
    }

    private void connectAndBrowse(PluginCall call, ComponentName component, String parentId) {
        final AtomicBoolean done = new AtomicBoolean(false);
        final MediaBrowser[] holder = new MediaBrowser[1];
        final Runnable timeout = () -> {
            if (done.compareAndSet(false, true)) {
                disconnectQuietly(holder[0]);
                call.reject("Timed out reading this app's library.");
            }
        };
        MediaBrowser.ConnectionCallback connection = new MediaBrowser.ConnectionCallback() {
            @Override
            public void onConnected() {
                try {
                    String root = parentId != null ? parentId : holder[0].getRoot();
                    holder[0].subscribe(root, new MediaBrowser.SubscriptionCallback() {
                        @Override
                        public void onChildrenLoaded(String parent, List<MediaBrowser.MediaItem> children) {
                            if (!done.compareAndSet(false, true)) return;
                            main.removeCallbacks(timeout);
                            JSObject result = new JSObject();
                            result.put("items", browseItems(children));
                            call.resolve(result);
                            disconnectQuietly(holder[0]);
                        }

                        @Override
                        public void onError(String parent) {
                            if (!done.compareAndSet(false, true)) return;
                            main.removeCallbacks(timeout);
                            call.reject("This player only shares its library with apps it allow-lists, such as Android Auto.");
                            disconnectQuietly(holder[0]);
                        }
                    });
                } catch (RuntimeException error) {
                    if (done.compareAndSet(false, true)) {
                        main.removeCallbacks(timeout);
                        call.reject("Browse failed.");
                        disconnectQuietly(holder[0]);
                    }
                }
            }

            @Override
            public void onConnectionFailed() {
                if (done.compareAndSet(false, true)) {
                    main.removeCallbacks(timeout);
                    call.reject("This player only shares its library with apps it allow-lists, such as Android Auto.");
                    disconnectQuietly(holder[0]);
                }
            }
        };
        try {
            holder[0] = new MediaBrowser(getContext(), component, connection, null);
            holder[0].connect();
            main.postDelayed(timeout, 12000);
        } catch (RuntimeException error) {
            call.reject("Couldn't connect to this app.");
        }
    }

    private JSArray browseItems(List<MediaBrowser.MediaItem> items) {
        JSArray array = new JSArray();
        if (items == null) return array;
        for (MediaBrowser.MediaItem item : items) {
            MediaDescription description = item.getDescription();
            JSObject entry = new JSObject();
            String id = description.getMediaId();
            entry.put("id", id == null ? "" : id);
            entry.put("title", description.getTitle() == null ? "" : description.getTitle().toString());
            entry.put("subtitle", description.getSubtitle() == null ? "" : description.getSubtitle().toString());
            entry.put("browsable", item.isBrowsable());
            entry.put("playable", item.isPlayable());
            Uri icon = description.getIconUri();
            entry.put("icon", icon == null ? JSObject.NULL : icon.toString());
            array.put(entry);
        }
        return array;
    }

    @PluginMethod
    public void mediaPlayId(PluginCall call) {
        String packageName = call.getString("package", "");
        String mediaId = call.getString("mediaId", "");
        if (packageName == null || packageName.isEmpty() || mediaId == null || mediaId.isEmpty()) {
            call.reject("package and mediaId required");
            return;
        }
        ComponentName component = mediaBrowserComponent(packageName);
        if (component == null) {
            call.reject("This app can't start playback by id.");
            return;
        }
        main.post(() -> connectAndPlay(call, component, mediaId));
    }

    private void connectAndPlay(PluginCall call, ComponentName component, String mediaId) {
        final AtomicBoolean done = new AtomicBoolean(false);
        final MediaBrowser[] holder = new MediaBrowser[1];
        final Runnable timeout = () -> {
            if (done.compareAndSet(false, true)) {
                disconnectQuietly(holder[0]);
                call.reject("Timed out starting playback.");
            }
        };
        MediaBrowser.ConnectionCallback connection = new MediaBrowser.ConnectionCallback() {
            @Override
            public void onConnected() {
                if (!done.compareAndSet(false, true)) return;
                main.removeCallbacks(timeout);
                try {
                    MediaSession.Token token = holder[0].getSessionToken();
                    MediaController target = new MediaController(getContext(), token);
                    target.getTransportControls().playFromMediaId(mediaId, null);
                    call.resolve();
                } catch (RuntimeException error) {
                    call.reject("Couldn't start playback.");
                } finally {
                    // Let the session start, then refresh now-playing and drop the browser.
                    main.postDelayed(() -> selectController(), 800);
                    main.postDelayed(() -> disconnectQuietly(holder[0]), 3000);
                }
            }

            @Override
            public void onConnectionFailed() {
                if (done.compareAndSet(false, true)) {
                    main.removeCallbacks(timeout);
                    call.reject("Couldn't connect to this app.");
                    disconnectQuietly(holder[0]);
                }
            }
        };
        try {
            holder[0] = new MediaBrowser(getContext(), component, connection, null);
            holder[0].connect();
            main.postDelayed(timeout, 12000);
        } catch (RuntimeException error) {
            call.reject("Couldn't connect to this app.");
        }
    }

    private void disconnectQuietly(MediaBrowser browser) {
        if (browser == null) return;
        try {
            browser.disconnect();
        } catch (RuntimeException ignored) {
            // already gone
        }
    }

    // ---- Spotify (App Remote) ---------------------------------------------------------

    private SpotifyRemote spotify;

    private synchronized SpotifyRemote spotify() {
        // Must be the Activity, not the Application context: App Remote's showAuthView needs a
        // window to put the "allow this app to use Spotify" screen in. With the application
        // context it can't show it and fails with "Explicit user authorization is required".
        if (spotify == null) spotify = new SpotifyRemote(getActivity() != null ? getActivity() : getContext());
        return spotify;
    }

    /**
     * Runs Spotify's consent flow. App Remote refuses with "explicit user authorization is
     * required" until this has been completed once; its own showAuthView doesn't present it.
     */
    @PluginMethod
    public void spotifyAuthorize(PluginCall call) {
        String clientId = call.getString("clientId", "");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("No Spotify client ID is configured.");
            return;
        }
        if (getActivity() == null) {
            call.reject("Can't show the Spotify sign-in right now.");
            return;
        }
        AuthorizationRequest request = new AuthorizationRequest
            .Builder(clientId, AuthorizationResponse.Type.TOKEN, SpotifyRemote.REDIRECT_URI)
            .setScopes(new String[] { "app-remote-control" })
            .build();
        startActivityForResult(call, AuthorizationClient.createLoginActivityIntent(getActivity(), request), "spotifyAuthResult");
    }

    @ActivityCallback
    private void spotifyAuthResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        AuthorizationResponse response = AuthorizationClient.getResponse(result.getResultCode(), result.getData());
        if (response.getType() == AuthorizationResponse.Type.TOKEN) {
            call.resolve();
            return;
        }
        String error = response.getError();
        if (response.getType() == AuthorizationResponse.Type.ERROR && error != null && !error.isEmpty()) call.reject(error);
        else call.reject("Spotify sign-in was cancelled.");
    }

    @PluginMethod
    public void spotifyBrowse(PluginCall call) {
        String clientId = call.getString("clientId", "");
        String parentId = call.getString("parentId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("No Spotify client ID is configured.");
            return;
        }
        if (!SpotifyRemote.installed(getContext())) {
            call.reject("Spotify isn't installed on this phone.");
            return;
        }
        // App Remote connects (and may show its auth screen), so it has to run on the UI thread.
        main.post(() -> spotify().browse(clientId, parentId, new SpotifyRemote.ItemsCallback() {
            @Override
            public void items(JSArray items) {
                JSObject result = new JSObject();
                result.put("items", items);
                call.resolve(result);
            }

            @Override
            public void failed(String message) {
                call.reject(message);
            }
        }));
    }

    @PluginMethod
    public void spotifyPlay(PluginCall call) {
        String clientId = call.getString("clientId", "");
        String id = call.getString("id", "");
        if (clientId == null || clientId.isEmpty() || id == null || id.isEmpty()) {
            call.reject("A Spotify client ID and item are required.");
            return;
        }
        main.post(() -> spotify().play(clientId, id, new SpotifyRemote.DoneCallback() {
            @Override
            public void done() {
                call.resolve();
            }

            @Override
            public void failed(String message) {
                call.reject(message);
            }
        }));
    }

    // ---- In-app updater ---------------------------------------------------------------

    @PluginMethod
    public void appInfo(PluginCall call) {
        JSObject result = new JSObject();
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            result.put("versionCode", (int) code);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
        } catch (PackageManager.NameNotFoundException error) {
            result.put("versionCode", 0);
            result.put("versionName", "");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                dir.mkdirs();
                File apk = new File(dir, "raven-gps.apk");
                downloadTo(url, apk);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject result = new JSObject();
                result.put("started", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Update failed: " + error.getMessage());
            }
        }).start();
    }

    private void downloadTo(String url, File dest) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        try {
            int code = connection.getResponseCode();
            // GitHub asset URLs redirect to a CDN; HttpURLConnection won't follow across
            // http<->https, so follow one hop by hand when needed.
            if (code == HttpURLConnection.HTTP_MOVED_PERM || code == HttpURLConnection.HTTP_MOVED_TEMP || code == 307 || code == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                connection = (HttpURLConnection) new URL(location).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                code = connection.getResponseCode();
            }
            if (code != HttpURLConnection.HTTP_OK) throw new Exception("HTTP " + code);
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(dest)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }
}
