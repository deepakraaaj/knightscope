package com.kritilabs.knightscope;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Starts/stops {@link AnalysisService}. Notification permission is requested once on Android 13+, but optional. */
@CapacitorPlugin(
    name = "KnightScopeBackground",
    permissions = { @Permission(alias = KnightScopeBackgroundPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class KnightScopeBackgroundPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";
    private static final String TAG = "KnightScopeBackground";

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState(NOTIFICATIONS) == PermissionState.PROMPT) {
            requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        // Granted or denied, run anyway: without the permission the service still works,
        // only its notification is hidden from the shade.
        startService(call);
    }

    private void startService(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, AnalysisService.class)
            .putExtra(AnalysisService.EXTRA_TITLE, call.getString("title", "KnightScope"))
            .putExtra(AnalysisService.EXTRA_TEXT, call.getString("text", "Analysing your games"));
        try {
            ContextCompat.startForegroundService(ctx, intent);
            call.resolve();
        } catch (RuntimeException e) {
            // Android 12+ refuses foreground-service starts while the app is in the background.
            Log.e(TAG, "could not start analysis service", e);
            call.reject("Could not start background service: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), AnalysisService.class));
        } catch (RuntimeException e) {
            Log.w(TAG, "stopService failed", e);
        }
        call.resolve();
    }
}
