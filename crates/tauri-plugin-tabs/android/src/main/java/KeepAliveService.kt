package com.lucasgmagalhaes.idlehub.tabs

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service that keeps the process (and so the game webviews) running
 * while the app is in the background or the screen is off.
 */
class KeepAliveService : Service() {
    companion object {
        private const val CHANNEL_ID = "idlehub-keep-alive"
        private const val NOTIFICATION_ID = 1
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_TEXT = "text"

        private const val TAG = "IdleHub"

        /**
         * Starts or updates the service, or stops it when no tab is running.
         * Throws when the system refuses to start it (for example, Android 12+ while the app is in the background).
         */
        fun update(context: Context, activeTabs: Int, title: String, text: String) {
            val intent = Intent(context, KeepAliveService::class.java)
            if (activeTabs <= 0) {
                context.stopService(intent)
                return
            }
            intent.putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text)
            ContextCompat.startForegroundService(context, intent)
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = notification(
            intent?.getStringExtra(EXTRA_TITLE) ?: "IdleHub",
            intent?.getStringExtra(EXTRA_TEXT) ?: "",
        )
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: RuntimeException) {
            // Refused by the system: the tabs still run while the app is open, so do not crash it.
            Log.w(TAG, "could not keep the games running in the background", e)
            stopSelf()
            return START_NOT_STICKY
        }
        if (wakeLock == null) {
            // Keeps the CPU running with the screen off; released when the service stops.
            wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "idlehub:keep-alive")
                .apply {
                    setReferenceCounted(false)
                    acquire()
                }
        }
        // The webviews live in the activity, so restarting the service alone would be pointless.
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
    }

    override fun onDestroy() {
        wakeLock?.release()
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(title: String, text: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "IdleHub", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            // A notification without a valid icon is rejected, which would crash the service.
            .setSmallIcon(applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(launch)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }
}
