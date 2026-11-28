package com.dhedhitech.pattaparty;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InstallRefPlugin.class); // install source (where the player found the app)
        registerPlugin(ScreenRecPlugin.class); // hand replay -> video to share
        super.onCreate(savedInstanceState);
    }
}
