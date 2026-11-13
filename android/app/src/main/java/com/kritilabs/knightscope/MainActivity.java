package com.kritilabs.knightscope;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KnightScopeEnginePlugin.class);
        registerPlugin(KnightScopeBackgroundPlugin.class);
        registerPlugin(KnightScopeSystemUiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
