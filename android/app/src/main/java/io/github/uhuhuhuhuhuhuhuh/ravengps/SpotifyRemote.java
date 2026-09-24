package io.github.uhuhuhuhuhuhuhuh.ravengps;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.spotify.android.appremote.api.ConnectionParams;
import com.spotify.android.appremote.api.Connector;
import com.spotify.android.appremote.api.ContentApi;
import com.spotify.android.appremote.api.SpotifyAppRemote;
import com.spotify.protocol.types.ListItem;
import com.spotify.protocol.types.ListItems;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Spotify library browsing and playback through the App Remote SDK.
 *
 * Spotify's MediaBrowserService only hands a browse root to callers it allow-lists (Android
 * Auto, Wear OS, its own partners), so the generic MediaBrowser path in RavenNativePlugin gets
 * "No root for client" and nothing else. App Remote is the supported route for a third-party
 * app, and is how apps like Waze show Spotify playlists inline.
 *
 * Playback control needs a Spotify Premium account; free accounts are refused by Spotify.
 */
class SpotifyRemote {
    /** Must match the redirect URI registered for the client ID in Spotify's dashboard. */
    static final String REDIRECT_URI = "ravengps://callback";
    private static final int PAGE = 50;

    interface ItemsCallback {
        void items(JSArray items);
        void failed(String message);
    }

    interface DoneCallback {
        void done();
        void failed(String message);
    }

    private interface Ready {
        void run(SpotifyAppRemote remote);
    }

    /** App Remote can stay silent indefinitely (e.g. Spotify itself can't reach the network). */
    private static final long TIMEOUT_MS = 15_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Context context;
    private SpotifyAppRemote remote;
    /** Children are fetched by object, not id, so keep what we handed the web layer. */
    private final Map<String, ListItem> items = new HashMap<>();

    SpotifyRemote(Context context) {
        this.context = context;
    }

    static boolean installed(Context context) {
        return SpotifyAppRemote.isSpotifyInstalled(context);
    }

    private static String message(Throwable error, String fallback) {
        if (error == null) return fallback;
        String text = error.getMessage();
        return text == null || text.isEmpty() ? fallback : text;
    }

    /** Connects on first use and reuses the connection afterwards. Call on the main thread. */
    private void connected(String clientId, Ready ready, ItemsCallback onError) {
        if (remote != null && remote.isConnected()) {
            ready.run(remote);
            return;
        }
        ConnectionParams params = new ConnectionParams.Builder(clientId)
            .setRedirectUri(REDIRECT_URI)
            .showAuthView(true)
            .build();
        SpotifyAppRemote.connect(context, params, new Connector.ConnectionListener() {
            @Override
            public void onConnected(SpotifyAppRemote connected) {
                remote = connected;
                ready.run(connected);
            }

            @Override
            public void onFailure(Throwable error) {
                onError.failed(message(error, "Couldn't connect to Spotify."));
            }
        });
    }

    /** Answers exactly once, and always: App Remote may never call back at all. */
    private ItemsCallback once(ItemsCallback callback) {
        AtomicBoolean done = new AtomicBoolean(false);
        main.postDelayed(() -> {
            if (done.compareAndSet(false, true)) callback.failed("Spotify didn't respond. Check it's signed in and online, then try again.");
        }, TIMEOUT_MS);
        return new ItemsCallback() {
            @Override
            public void items(JSArray items) {
                if (done.compareAndSet(false, true)) callback.items(items);
            }

            @Override
            public void failed(String message) {
                if (done.compareAndSet(false, true)) callback.failed(message);
            }
        };
    }

    /** Top level when parentId is null, otherwise the children of that item. */
    void browse(String clientId, String parentId, ItemsCallback raw) {
        ItemsCallback callback = once(raw);
        connected(clientId, spotify -> {
            ContentApi content = spotify.getContentApi();
            if (parentId == null || parentId.isEmpty()) {
                content.getRecommendedContentItems(ContentApi.ContentType.NAVIGATION)
                    .setResultCallback(result -> callback.items(toJson(result)))
                    .setErrorCallback(error -> callback.failed(message(error, "Spotify wouldn't return your library.")));
                return;
            }
            ListItem parent = items.get(parentId);
            if (parent == null) {
                callback.failed("That Spotify item is no longer available; go back and try again.");
                return;
            }
            content.getChildrenOfItem(parent, PAGE, 0)
                .setResultCallback(result -> callback.items(toJson(result)))
                .setErrorCallback(error -> callback.failed(message(error, "Spotify wouldn't open that.")));
        }, callback);
    }

    void play(String clientId, String id, DoneCallback raw) {
        AtomicBoolean done = new AtomicBoolean(false);
        main.postDelayed(() -> {
            if (done.compareAndSet(false, true)) raw.failed("Spotify didn't respond. Check it's signed in and online, then try again.");
        }, TIMEOUT_MS);
        DoneCallback callback = new DoneCallback() {
            @Override
            public void done() {
                if (done.compareAndSet(false, true)) raw.done();
            }

            @Override
            public void failed(String message) {
                if (done.compareAndSet(false, true)) raw.failed(message);
            }
        };
        ItemsCallback bridge = new ItemsCallback() {
            @Override
            public void items(JSArray ignored) {}

            @Override
            public void failed(String problem) {
                callback.failed(problem);
            }
        };
        connected(clientId, spotify -> {
            ListItem item = items.get(id);
            if (item != null) {
                spotify.getContentApi().playContentItem(item)
                    .setResultCallback(result -> callback.done())
                    .setErrorCallback(error -> callback.failed(message(error, "Spotify wouldn't play that.")));
                return;
            }
            // Not browsed this session: fall back to treating the id as a Spotify URI.
            spotify.getPlayerApi().play(id)
                .setResultCallback(result -> callback.done())
                .setErrorCallback(error -> callback.failed(message(error, "Spotify wouldn't play that.")));
        }, bridge);
    }

    private JSArray toJson(ListItems list) {
        JSArray array = new JSArray();
        if (list == null || list.items == null) return array;
        for (ListItem item : list.items) {
            if (item == null) continue;
            String id = item.id != null && !item.id.isEmpty() ? item.id : item.uri;
            if (id == null || id.isEmpty()) continue;
            items.put(id, item);
            JSObject entry = new JSObject();
            entry.put("id", id);
            entry.put("title", item.title == null ? "" : item.title);
            entry.put("subtitle", item.subtitle == null ? "" : item.subtitle);
            entry.put("browsable", item.hasChildren);
            entry.put("playable", item.playable);
            entry.put("icon", JSObject.NULL);
            array.put(entry);
        }
        return array;
    }

    void release() {
        if (remote != null) {
            SpotifyAppRemote.disconnect(remote);
            remote = null;
        }
        items.clear();
    }
}
