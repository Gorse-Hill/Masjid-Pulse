package com.masjidpulse.salat

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/** Plays a user-selected recording; no Adhan media is bundled with the app. */
class AdhanPlaybackService : Service() {
    private var player: MediaPlayer? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == NotificationHelper.ACTION_STOP_ADHAN) {
            stopSelf()
            return START_NOT_STICKY
        }
        val settings = AlertPreferences(this).load()
        val uri = settings.adhanUri?.let(Uri::parse)
        if (uri == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val request = intent ?: return stopIncomplete()
        val date = request.getStringExtra(AlertScheduler.EXTRA_DATE) ?: return stopIncomplete()
        val prayer = request.getStringExtra(AlertScheduler.EXTRA_PRAYER)
            ?.let { name -> PrayerKey.entries.firstOrNull { it.name == name } }
            ?: return stopIncomplete()
        val event = PrayerEvent(
            date,
            prayer,
            request.getLongExtra(AlertScheduler.EXTRA_TRIGGER, 0),
            settings.timezone,
        )
        val test = request.getBooleanExtra("test", false)
        val notification = NotificationHelper.playbackNotification(this, event, test)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NotificationHelper.ADHAN_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NotificationHelper.ADHAN_NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {
            NotificationHelper.deliver(this, event, AlertMode.SOUND, test)
            stopSelf()
            return START_NOT_STICKY
        }

        player?.release()
        player = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .build(),
            )
            setWakeMode(this@AdhanPlaybackService, PowerManager.PARTIAL_WAKE_LOCK)
            setOnPreparedListener { start() }
            setOnCompletionListener {
                stopSelf()
            }
            setOnErrorListener { _, _, _ ->
                NotificationHelper.deliver(this@AdhanPlaybackService, event, AlertMode.SOUND, test)
                stopSelf()
                true
            }
            try {
                setDataSource(this@AdhanPlaybackService, uri)
                prepareAsync()
            } catch (_: Exception) {
                NotificationHelper.deliver(this@AdhanPlaybackService, event, AlertMode.SOUND, test)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun stopIncomplete(): Int {
        stopSelf()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        player?.runCatching {
            if (isPlaying) stop()
            release()
        }
        player = null
        super.onDestroy()
    }
}
