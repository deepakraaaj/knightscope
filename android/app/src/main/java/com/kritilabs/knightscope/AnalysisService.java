package com.kritilabs.knightscope;

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
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground service that keeps the app process (WebView + Stockfish child process) alive while a
 * batch analysis runs with the app minimised. Holds a partial wake lock so the CPU keeps working
 * with the screen off. It does no work itself; the analysis keeps running in the WebView/engine.
 */
public class AnalysisService extends Service {

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";
    private static final String TAG = "KnightScopeBackground";
    private static final String CHANNEL_ID = "knightscope_analysis";
    private static final int NOTIFICATION_ID = 4711;
    /** Safety cap so a forgotten stop() can never drain the battery indefinitely. */
    private static final long WAKE_LOCK_TIMEOUT_MS = 6L * 60 * 60 * 1000;

    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        Notification notification = buildNotification(title != null ? title : "KnightScope", text != null ? text : "Analysing your games");
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
        } catch (RuntimeException e) {
            // e.g. ForegroundServiceStartNotAllowedException; never crash the app over this.
            Log.e(TAG, "startForeground failed", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        acquireWakeLock();
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Game analysis", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while KnightScope analyses games in the background");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_analysis)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KnightScope:analysis");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (RuntimeException ignored) {}
        }
        wakeLock = null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // App swiped away: the WebView driving the analysis is gone, so there is nothing to keep alive.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
