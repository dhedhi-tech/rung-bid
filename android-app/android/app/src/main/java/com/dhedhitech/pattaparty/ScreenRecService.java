package com.dhedhitech.pattaparty;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.getcapacitor.PluginCall;

// Android only allows screen recording from a foreground service (with the "Recording" notification).
public class ScreenRecService extends Service {
    static volatile PluginCall pending;        // ScreenRec.start() waiting for the recording to begin
    static volatile ScreenRecorder recorder;    // the running recording
    private static final String CH = "replay_rec";

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        PluginCall call = pending; pending = null;
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null)
                nm.createNotificationChannel(new NotificationChannel(CH, "Replay videos", NotificationManager.IMPORTANCE_LOW));
            Notification n = new NotificationCompat.Builder(this, CH)
                .setContentTitle("Patta Party").setContentText("Making your replay video…")
                .setSmallIcon(android.R.drawable.presence_video_online).setOngoing(true).build();
            ServiceCompat.startForeground(this, 7, n, Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0);

            MediaProjectionManager m = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent data = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra("data", Intent.class) : intent.getParcelableExtra("data");
            MediaProjection mp = m.getMediaProjection(intent.getIntExtra("code", 0), data);
            if (mp == null) throw new IllegalStateException("no permission");
            ScreenRecorder r = new ScreenRecorder(mp, intent.getIntExtra("w", 720), intent.getIntExtra("h", 1280), intent.getIntExtra("dpi", 320),
                intent.getBooleanExtra("audio", false), intent.getStringExtra("path"));
            r.start();
            recorder = r;
            if (call != null) { com.getcapacitor.JSObject o = new com.getcapacitor.JSObject(); o.put("audio", r.hasAudio()); call.resolve(o); }
        } catch (Exception e) {
            recorder = null;
            if (call != null) call.reject("could not record: " + e.getMessage());
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        ScreenRecorder r = recorder; recorder = null;
        if (r != null) try { r.stop(); } catch (Exception e) { }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        super.onDestroy();
    }
}
