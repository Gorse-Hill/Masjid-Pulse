package com.masjidpulse.salat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object NotificationHelper {
    private const val SILENT_CHANNEL = "salat_silent_v1"
    private const val SOUND_CHANNEL = "salat_sound_v1"
    private const val ADHAN_CHANNEL = "salat_adhan_v1"
    const val ADHAN_NOTIFICATION_ID = 8142
    const val ACTION_STOP_ADHAN = "com.masjidpulse.salat.STOP_ADHAN"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val silent = NotificationChannel(
            SILENT_CHANNEL,
            context.getString(R.string.channel_silent),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            setSound(null, null)
            enableVibration(false)
        }
        val sound = NotificationChannel(
            SOUND_CHANNEL,
            context.getString(R.string.channel_sound),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build(),
            )
        }
        val adhan = NotificationChannel(
            ADHAN_CHANNEL,
            context.getString(R.string.channel_adhan),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply { setSound(null, null) }
        manager.createNotificationChannels(listOf(silent, sound, adhan))
    }

    fun deliver(context: Context, event: PrayerEvent, mode: AlertMode, test: Boolean = false) {
        val settings = AlertPreferences(context).load()
        if (mode == AlertMode.ADHAN && settings.adhanUri != null) {
            val intent = Intent(context, AdhanPlaybackService::class.java).apply {
                putExtra(AlertScheduler.EXTRA_DATE, event.date)
                putExtra(AlertScheduler.EXTRA_PRAYER, event.prayer.name)
                putExtra(AlertScheduler.EXTRA_TRIGGER, event.triggerAtMillis)
                putExtra("test", test)
            }
            runCatching { context.startForegroundService(intent) }
                .onFailure { notify(context, event, AlertMode.SOUND, test) }
        } else {
            val effectiveMode = if (mode == AlertMode.SILENT) AlertMode.SILENT else AlertMode.SOUND
            notify(context, event, effectiveMode, test)
        }
    }

    fun playbackNotification(context: Context, event: PrayerEvent, test: Boolean): Notification =
        notification(context, event, AlertMode.ADHAN, test)

    private fun notify(context: Context, event: PrayerEvent, mode: AlertMode, test: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(event.id.hashCode(), notification(context, event, mode, test))
    }

    private fun notification(
        context: Context,
        event: PrayerEvent,
        mode: AlertMode,
        test: Boolean,
    ): Notification {
        val channel = when (mode) {
            AlertMode.SILENT -> SILENT_CHANNEL
            AlertMode.SOUND -> SOUND_CHANNEL
            AlertMode.ADHAN -> ADHAN_CHANNEL
        }
        val openApp = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = if (test) "Test alert · ${event.prayer.displayName}" else
            "${event.prayer.displayName} · ${formatTime(event)}"
        val builder = Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(
                when {
                    test && mode == AlertMode.ADHAN -> "Test Adhan playback is active."
                    test -> "Test notification delivered."
                    else -> "It is time for ${event.prayer.displayName}."
                },
            )
            .setContentIntent(openApp)
            .setAutoCancel(mode != AlertMode.ADHAN)
            .setOngoing(mode == AlertMode.ADHAN)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        if (mode == AlertMode.ADHAN) {
            val stop = PendingIntent.getService(
                context,
                1,
                Intent(context, AdhanPlaybackService::class.java).setAction(ACTION_STOP_ADHAN),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(
                Notification.Action.Builder(null, context.getString(R.string.stop_adhan), stop).build(),
            )
            builder.setDeleteIntent(stop)
        }
        return builder.build()
    }

    private fun formatTime(event: PrayerEvent): String =
        SimpleDateFormat("HH:mm", Locale.getDefault()).apply {
            timeZone = TimeZone.getTimeZone(event.timezone)
        }.format(Date(event.triggerAtMillis))
}
