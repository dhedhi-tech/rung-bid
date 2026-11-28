package com.dhedhitech.pattaparty;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.DisplayMetrics;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;

// Hand replay -> video (Nov 29 2026). The web app plays a replay and records the app's own screen with game sound,
// then shares the MP4 file (Share plugin). Web side: Capacitor.Plugins.ScreenRec.start({ audio }) / stop() -> { path }.
// Android asks the player once per video ("Start recording?"). Game sound needs Android 10+ and the microphone
// permission (Android's rule for recording app sound); without it the video is silent.
@CapacitorPlugin(name = "ScreenRec", permissions = { @Permission(alias = "audio", strings = { Manifest.permission.RECORD_AUDIO }) })
public class ScreenRecPlugin extends Plugin {
    private boolean wantAudio = true;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ok", Build.VERSION.SDK_INT >= 24);
        o.put("audio", Build.VERSION.SDK_INT >= 29);
        call.resolve(o);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (ScreenRecService.recorder != null) { call.reject("already recording"); return; }
        wantAudio = call.getBoolean("audio", true) && Build.VERSION.SDK_INT >= 29;
        if (wantAudio && getPermissionState("audio") != PermissionState.GRANTED) { requestPermissionForAlias("audio", call, "audioPerm"); return; }
        askCapture(call);
    }

    @PermissionCallback
    private void audioPerm(PluginCall call) {
        if (getPermissionState("audio") != PermissionState.GRANTED) wantAudio = false; // record without sound
        askCapture(call);
    }

    private void askCapture(PluginCall call) {
        MediaProjectionManager m = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, m.createScreenCaptureIntent(), "captureResult");
    }

    @ActivityCallback
    private void captureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("cancelled"); return; }
        DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
        File out = new File(getContext().getCacheDir(), "patta-party-replay.mp4");
        if (out.exists()) out.delete();
        ScreenRecService.pending = call;
        Intent i = new Intent(getContext(), ScreenRecService.class);
        i.putExtra("code", result.getResultCode());
        i.putExtra("data", result.getData());
        i.putExtra("w", dm.widthPixels); i.putExtra("h", dm.heightPixels); i.putExtra("dpi", dm.densityDpi);
        i.putExtra("audio", wantAudio);
        i.putExtra("path", out.getAbsolutePath());
        try { ContextCompat.startForegroundService(getContext(), i); }
        catch (Exception e) { ScreenRecService.pending = null; call.reject("could not start: " + e.getMessage()); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ScreenRecorder r = ScreenRecService.recorder;
        if (r == null) { call.reject("not recording"); return; }
        new Thread(() -> {
            String path = null, err = null; boolean audio = false;
            try { path = r.stop(); audio = r.hasAudio(); } catch (Exception e) { err = e.getMessage(); }
            ScreenRecService.recorder = null;
            Context c = getContext();
            c.stopService(new Intent(c, ScreenRecService.class));
            if (path == null) { call.reject(err != null ? err : "no video"); return; }
            JSObject o = new JSObject();
            o.put("path", "file://" + path);
            o.put("audio", audio);
            call.resolve(o);
        }).start();
    }
}
