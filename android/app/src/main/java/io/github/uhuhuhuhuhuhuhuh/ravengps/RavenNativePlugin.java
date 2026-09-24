package io.github.uhuhuhuhuhuhuhuh.ravengps;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
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
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

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
        PackageManager manager = getContext().getPackageManager();
        for (int index = 0; index < requested.length(); index++) {
            String packageName = requested.optString(index, "");
            if (!packageName.isEmpty() && manager.getLaunchIntentForPackage(packageName) != null) installed.put(packageName);
        }
        JSObject result = new JSObject();
        result.put("installed", installed);
        call.resolve(result);
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
}
