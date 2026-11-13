package com.kritilabs.knightscope;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the Android status and navigation bars matching the app theme. On Android 14 and older the
 * bars have their own colour (on 15+ the app draws behind them, so the colour call is a no-op).
 */
@CapacitorPlugin(name = "KnightScopeSystemUi")
public class KnightScopeSystemUiPlugin extends Plugin {

    @PluginMethod
    public void setBars(PluginCall call) {
        final String hex = call.getString("color", "#0B1020");
        // The navigation bar sits under the app's bottom tab bar, so it takes that colour.
        final String navHex = call.getString("navColor", hex);
        final boolean lightBackground = Boolean.TRUE.equals(call.getBoolean("lightBackground", false));
        final int color;
        final int navColor;
        try {
            color = Color.parseColor(hex);
            navColor = Color.parseColor(navHex);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid colour");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            window.setStatusBarColor(color);
            window.setNavigationBarColor(navColor);
            // With gesture navigation the bar is transparent and shows the window background, so it matches the tab bar too.
            window.getDecorView().setBackgroundColor(navColor);
            WindowInsetsControllerCompat c = new WindowInsetsControllerCompat(window, window.getDecorView());
            // Dark icons on a light background, light icons on a dark background.
            c.setAppearanceLightStatusBars(lightBackground);
            c.setAppearanceLightNavigationBars(lightBackground);
            call.resolve();
        });
    }
}
