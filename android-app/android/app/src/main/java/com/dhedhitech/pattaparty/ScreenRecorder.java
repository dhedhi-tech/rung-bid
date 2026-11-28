package com.dhedhitech.pattaparty;

import android.annotation.SuppressLint;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Surface;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

// Records the screen (H.264, 720px wide) and, on Android 10+, the app's own sound (AAC) into one MP4.
class ScreenRecorder {
    private static final int RATE = 44100;
    private final MediaProjection mp;
    private final int dpi; private final String path; private final boolean wantAudio;
    private int w, h;
    private MediaCodec venc, aenc; private Surface input; private VirtualDisplay vd; private AudioRecord ar; private MediaMuxer mux;
    private final Object lock = new Object();
    private int vTrack = -1, aTrack = -1; private boolean muxOn = false, audioOn = false, stopped = false;
    private long lastV = -1, lastA = -1; private int vSamples = 0;
    private final List<Object[]> waiting = new ArrayList<>(); // samples that came before both tracks were known
    private long baseUs; private volatile boolean running;
    private Thread vThread, aThread;

    ScreenRecorder(MediaProjection mp, int sw, int sh, int dpi, boolean audio, String path) {
        this.mp = mp; this.dpi = dpi; this.path = path; this.wantAudio = audio;
        int tw = Math.min(720, sw); // 720 px wide is plenty for WhatsApp / YouTube Shorts and keeps files small
        w = tw / 16 * 16; h = Math.round((float) sh * tw / sw) / 16 * 16;
    }

    boolean hasAudio() { return audioOn && aTrack >= 0; }

    @SuppressLint("MissingPermission")
    void start() throws Exception {
        MediaFormat vf = MediaFormat.createVideoFormat("video/avc", w, h);
        vf.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        vf.setInteger(MediaFormat.KEY_BIT_RATE, 4_000_000);
        vf.setInteger(MediaFormat.KEY_FRAME_RATE, 30);
        vf.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
        vf.setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000 / 30); // steady frames while the screen is still
        venc = MediaCodec.createEncoderByType("video/avc");
        venc.configure(vf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        input = venc.createInputSurface();
        mux = new MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

        if (wantAudio && Build.VERSION.SDK_INT >= 29) {
            try {
                AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(mp)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build();
                AudioFormat af = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build();
                int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
                ar = new AudioRecord.Builder().setAudioFormat(af).setBufferSizeInBytes(Math.max(min * 2, 16384)).setAudioPlaybackCaptureConfig(cfg).build();
                MediaFormat aff = MediaFormat.createAudioFormat("audio/mp4a-latm", RATE, 2);
                aff.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
                aff.setInteger(MediaFormat.KEY_BIT_RATE, 128_000);
                aff.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
                aenc = MediaCodec.createEncoderByType("audio/mp4a-latm");
                aenc.configure(aff, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
                audioOn = ar.getState() == AudioRecord.STATE_INITIALIZED;
            } catch (Exception e) { audioOn = false; }
            if (!audioOn) releaseAudio();
        }

        mp.registerCallback(new MediaProjection.Callback() { // Android 14+ needs this before createVirtualDisplay
            @Override public void onStop() { running = false; }
        }, new Handler(Looper.getMainLooper()));
        venc.start();
        vd = mp.createVirtualDisplay("patta-party-replay", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, input, null, null);
        baseUs = System.nanoTime() / 1000;
        running = true;
        vThread = new Thread(this::videoLoop, "rec-video"); vThread.start();
        if (audioOn) { aThread = new Thread(this::audioLoop, "rec-audio"); aThread.start(); }
    }

    private void videoLoop() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        try {
            while (true) {
                int i = venc.dequeueOutputBuffer(info, 10_000);
                if (i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) addTrack(true, venc.getOutputFormat());
                else if (i >= 0) {
                    boolean eos = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size > 0)
                        write(true, venc.getOutputBuffer(i), info, info.presentationTimeUs - baseUs);
                    venc.releaseOutputBuffer(i, false);
                    if (eos) break;
                } else if (!running && stopped) break;
            }
        } catch (Exception e) { /* stop() reports an empty video */ }
    }

    private void audioLoop() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        long frames = 0; long startUs = -1;
        try {
            aenc.start(); ar.startRecording();
            boolean eosSent = false;
            while (true) {
                if (!eosSent) {
                    int ii = aenc.dequeueInputBuffer(10_000);
                    if (ii >= 0) {
                        ByteBuffer b = aenc.getInputBuffer(ii); b.clear();
                        if (!running) { aenc.queueInputBuffer(ii, 0, 0, pts(startUs, frames), MediaCodec.BUFFER_FLAG_END_OF_STREAM); eosSent = true; }
                        else {
                            int n = ar.read(b, Math.min(b.capacity(), 8192));
                            if (n < 0) n = 0;
                            if (startUs < 0) startUs = System.nanoTime() / 1000 - baseUs - n / 4 * 1_000_000L / RATE;
                            aenc.queueInputBuffer(ii, 0, n, pts(startUs, frames), 0);
                            frames += n / 4; // 2 channels x 16 bit
                        }
                    }
                }
                int o = aenc.dequeueOutputBuffer(info, eosSent ? 10_000 : 0);
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) addTrack(false, aenc.getOutputFormat());
                else if (o >= 0) {
                    boolean eos = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size > 0) write(false, aenc.getOutputBuffer(o), info, info.presentationTimeUs);
                    aenc.releaseOutputBuffer(o, false);
                    if (eos) break;
                }
            }
        } catch (Exception e) {
            synchronized (lock) { // sound failed: carry on with a silent video
                audioOn = false;
                if (!muxOn && vTrack >= 0) startMux();
            }
        }
    }

    private static long pts(long startUs, long frames) { return Math.max(0, startUs) + frames * 1_000_000L / RATE; }

    private void addTrack(boolean video, MediaFormat f) {
        synchronized (lock) {
            if (muxOn) return;
            if (video) vTrack = mux.addTrack(f); else aTrack = mux.addTrack(f);
            if (vTrack >= 0 && (!audioOn || aTrack >= 0)) startMux();
        }
    }

    private void startMux() { // with the lock held
        if (aTrack < 0) audioOn = false;
        mux.start(); muxOn = true;
        for (Object[] s : waiting) put((Boolean) s[0], (ByteBuffer) s[1], (MediaCodec.BufferInfo) s[2]);
        waiting.clear();
    }

    private void write(boolean video, ByteBuffer buf, MediaCodec.BufferInfo info, long ptsUs) {
        MediaCodec.BufferInfo bi = new MediaCodec.BufferInfo();
        bi.set(0, info.size, Math.max(0, ptsUs), info.flags);
        buf.position(info.offset); buf.limit(info.offset + info.size);
        synchronized (lock) {
            if (!muxOn) {
                if (waiting.size() > 600) return; // something is stuck: don't fill the memory
                ByteBuffer copy = ByteBuffer.allocate(info.size); copy.put(buf); copy.flip();
                waiting.add(new Object[] { video, copy, bi });
                return;
            }
            put(video, buf, bi);
        }
    }

    private void put(boolean video, ByteBuffer buf, MediaCodec.BufferInfo bi) { // with the lock held
        if (!video && (!audioOn || aTrack < 0)) return;
        long last = video ? lastV : lastA;
        if (bi.presentationTimeUs < last) bi.presentationTimeUs = last; // timestamps must not go back
        mux.writeSampleData(video ? vTrack : aTrack, buf, bi);
        if (video) { lastV = bi.presentationTimeUs; vSamples++; } else lastA = bi.presentationTimeUs;
    }

    // Finish the file. Returns its path, or throws when nothing was recorded.
    String stop() throws Exception {
        synchronized (this) { if (stopped) return vSamples > 0 ? path : null; stopped = true; }
        running = false;
        try { venc.signalEndOfInputStream(); } catch (Exception e) { }
        try { if (aThread != null) aThread.join(3000); } catch (Exception e) { }
        try { if (vThread != null) vThread.join(3000); } catch (Exception e) { }
        try { if (vd != null) vd.release(); } catch (Exception e) { }
        try { mp.stop(); } catch (Exception e) { }
        releaseAudio();
        try { venc.stop(); } catch (Exception e) { }
        try { venc.release(); } catch (Exception e) { }
        try { if (input != null) input.release(); } catch (Exception e) { }
        boolean ok;
        synchronized (lock) {
            ok = muxOn && vSamples > 0;
            try { if (muxOn) mux.stop(); } catch (Exception e) { ok = false; }
            try { mux.release(); } catch (Exception e) { }
        }
        if (!ok) throw new IllegalStateException("empty video");
        return path;
    }

    private void releaseAudio() {
        try { if (ar != null) { ar.stop(); } } catch (Exception e) { }
        try { if (ar != null) ar.release(); } catch (Exception e) { }
        try { if (aenc != null) aenc.stop(); } catch (Exception e) { }
        try { if (aenc != null) aenc.release(); } catch (Exception e) { }
        ar = null; aenc = null;
    }
}
