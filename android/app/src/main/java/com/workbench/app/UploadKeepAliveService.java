package com.workbench.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * 上传期间的前台服务：把 App 保活，退到后台/锁屏也能继续传。
 *
 * 安卓在 App 切到后台后会逐步把整个应用（含 WebView）冻结，正在传的图随之停住；
 * 挂着前台服务 + 常驻通知就不会被冻结，通知里顺手显示上传进度。
 * 网页端通过 AppBridge 的 start/update/stopUploadKeepAlive 控制生命周期；
 * 另加一道自我超时：长时间没有进度更新就自行退出，避免通知卡死。
 */
public class UploadKeepAliveService extends Service {

    private static final String CHANNEL_ID = "upload-keep-alive";
    private static final int NOTIFICATION_ID = 4121;
    /** 超过这么久没有任何进度更新就自停（例如页面被换掉、网页侧已无人更新）。 */
    private static final long STALE_TIMEOUT_MS = 30 * 60 * 1000L;

    /** 拉起/更新：服务已在运行时重复 start 视为一次进度更新。 */
    public static void start(Context context, String text, int done, int total) {
        Intent intent = new Intent(context, UploadKeepAliveService.class);
        intent.putExtra("text", text);
        intent.putExtra("done", done);
        intent.putExtra("total", total);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, UploadKeepAliveService.class));
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean foreground = false;
    private final Runnable staleStop = this::stopSelf;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent == null ? null : intent.getStringExtra("text");
        int done = intent == null ? 0 : intent.getIntExtra("done", 0);
        int total = intent == null ? 0 : intent.getIntExtra("total", 0);
        Notification notification = buildNotification(text, done, total);
        if (!foreground) {
            foreground = true;
            startForeground(NOTIFICATION_ID, notification);
        } else {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, notification);
        }
        // 每来一次进度更新就续期：静默太久说明网页侧已经不在传了，自行退出。
        handler.removeCallbacks(staleStop);
        handler.postDelayed(staleStop, STALE_TIMEOUT_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(staleStop);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification(String text, int done, int total) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.upload_channel_name),
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(getString(R.string.upload_channel_description));
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle(getString(R.string.upload_notification_title))
                .setContentText(text == null || text.isEmpty() ? getString(R.string.upload_notification_default_text) : text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(contentIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW);
        if (total > 0) {
            builder.setProgress(100, Math.max(0, Math.min(100, (int) Math.round(done * 100.0 / total))), false);
        } else {
            builder.setProgress(0, 0, true);
        }
        return builder.build();
    }
}
