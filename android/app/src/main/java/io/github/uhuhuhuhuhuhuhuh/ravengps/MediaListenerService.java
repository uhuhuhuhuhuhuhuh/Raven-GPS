package io.github.uhuhuhuhuhuhuhuh.ravengps;

import android.service.notification.NotificationListenerService;

/**
 * Exists only so the user can grant Raven GPS "notification access", which Android
 * requires before an app may see other apps' media sessions (what's playing in Spotify,
 * Plexamp, YouTube Music, ...) and control them. It ignores notifications themselves.
 */
public class MediaListenerService extends NotificationListenerService {}
