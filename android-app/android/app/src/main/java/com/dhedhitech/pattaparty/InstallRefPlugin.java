package com.dhedhitech.pattaparty;

import android.content.SharedPreferences;
import android.provider.Settings;
import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Where this install came from (Google Play Install Referrer), e.g. "utm_source=share_win" or
// "utm_source=google-play&utm_medium=organic". Asked once, then kept on the phone.
// The web app reads it with Capacitor.Plugins.InstallRef.get()
@CapacitorPlugin(name = "InstallRef")
public class InstallRefPlugin extends Plugin {
    private static final String PREFS = "install_ref";

    @PluginMethod
    public void get(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences(PREFS, 0);
        if (sp.contains("ref")) { call.resolve(result(sp.getString("ref", ""), sp.getLong("at", 0))); return; }
        final InstallReferrerClient client;
        try { client = InstallReferrerClient.newBuilder(getContext()).build(); }
        catch (Exception e) { call.resolve(result("", 0)); return; }
        client.startConnection(new InstallReferrerStateListener() {
            private boolean done = false;
            @Override public void onInstallReferrerSetupFinished(int code) {
                if (done) return; done = true;
                String ref = ""; long at = 0;
                if (code == InstallReferrerClient.InstallReferrerResponse.OK) {
                    try {
                        ReferrerDetails d = client.getInstallReferrer();
                        ref = d.getInstallReferrer() == null ? "" : d.getInstallReferrer();
                        at = d.getInstallBeginTimestampSeconds();
                        sp.edit().putString("ref", ref).putLong("at", at).apply();
                    } catch (Exception e) { /* try again next open */ }
                } else if (code == InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED) {
                    sp.edit().putString("ref", "").putLong("at", 0).apply(); // not from Play (sideloaded / old store)
                }
                try { client.endConnection(); } catch (Exception e) { }
                call.resolve(result(ref, at));
            }
            @Override public void onInstallReferrerServiceDisconnected() {
                if (done) return; done = true;
                call.resolve(result("", 0));
            }
        });
    }

    // Google's own test phones (Play pre-launch report / Firebase Test Lab) set this system setting.
    // The game uses it to leave those phones out of the player stats.
    @PluginMethod
    public void testLab(PluginCall call) {
        boolean on = false;
        try { on = "true".equals(Settings.System.getString(getContext().getContentResolver(), "firebase.test.lab")); } catch (Exception e) { }
        JSObject o = new JSObject();
        o.put("testLab", on);
        call.resolve(o);
    }

    private JSObject result(String ref, long at) {
        JSObject o = new JSObject();
        o.put("ref", ref == null ? "" : ref);
        o.put("at", at);
        return o;
    }
}
