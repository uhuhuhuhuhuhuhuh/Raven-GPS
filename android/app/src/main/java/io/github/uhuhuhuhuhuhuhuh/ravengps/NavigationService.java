package io.github.uhuhuhuhuhuhuhuh.ravengps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Keeps navigation alive while the screen is locked or another app is in front.
 *
 * Android stops delivering location updates to a backgrounded app within seconds unless
 * it runs a foreground service with a visible notification, so this service starts when a
 * drive starts and stops when it ends. The notification doubles as a glanceable turn card
 * (next manoeuvre, distance, ETA); the web side updates it through the plugin.
 */
public class NavigationService extends Service {
    static final String CHANNEL = "navigation";
    static final int NOTIFICATION_ID = 41;
    static final String ACTION_START = "io.github.uhuhuhuhuhuhuhuh.ravengps.NAV_START";
    static final String ACTION_UPDATE = "io.github.uhuhuhuhuhuhuhuh.ravengps.NAV_UPDATE";
    static final String ACTION_STOP = "io.github.uhuhuhuhuhuhuhuh.ravengps.NAV_STOP";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_ETA = "eta";

    static void start(Context context, String title, String text, String eta) {
        Intent intent = new Intent(context, NavigationService.class).setAction(ACTION_START)
            .putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text).putExtra(EXTRA_ETA, eta);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    static void update(Context context, String title, String text, String eta) {
        context.startService(new Intent(context, NavigationService.class).setAction(ACTION_UPDATE)
            .putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text).putExtra(EXTRA_ETA, eta));
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, NavigationService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification notification = build(
            intent == null ? null : intent.getStringExtra(EXTRA_TITLE),
            intent == null ? null : intent.getStringExtra(EXTRA_TEXT),
            intent == null ? null : intent.getStringExtra(EXTRA_ETA));
        if (ACTION_UPDATE.equals(action)) {
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(NOTIFICATION_ID, notification);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification build(String title, String text, String eta) {
        ensureChannel();
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, flags);
        PendingIntent end = PendingIntent.getService(this, 1, new Intent(this, NavigationService.class).setAction(ACTION_STOP), flags);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_nav)
            .setContentTitle(title == null || title.isEmpty() ? getString(R.string.app_name) : title)
            .setContentText(text == null ? "" : text)
            .setSubText(eta)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(tap)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, getString(R.string.nav_end), end);
        return builder.build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, getString(R.string.nav_channel), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.nav_channel_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
