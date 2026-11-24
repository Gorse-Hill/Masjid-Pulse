package com.masjidpulse.salat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlertReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AlertScheduler.ACTION_PRAYER_ALERT) return
        val pending = goAsync()
        Thread {
            try {
                val settings = AlertPreferences(context).load()
                val prayer = PrayerKey.valueOf(intent.getStringExtra(AlertScheduler.EXTRA_PRAYER)!!)
                val preference = settings.alerts[prayer] ?: return@Thread
                if (!settings.configured || !preference.enabled) return@Thread
                val event = PrayerEvent(
                    intent.getStringExtra(AlertScheduler.EXTRA_DATE)!!,
                    prayer,
                    intent.getLongExtra(AlertScheduler.EXTRA_TRIGGER, 0),
                    settings.timezone,
                )
                NotificationHelper.deliver(context, event, preference.mode)
                // Keep the rolling 35-day window current without a network connection.
                AlertScheduler.scheduleAll(context)
            } catch (_: Exception) {
                // A stale or malformed alarm must not crash the phone's broadcast runtime.
            } finally {
                pending.finish()
            }
        }.start()
    }
}

class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val supported = intent.action in setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
        )
        if (!supported) return
        val pending = goAsync()
        Thread {
            try {
                AlertScheduler.scheduleAll(context)
            } finally {
                pending.finish()
            }
        }.start()
    }
}
