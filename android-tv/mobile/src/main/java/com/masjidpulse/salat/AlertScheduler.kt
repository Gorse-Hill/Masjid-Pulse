package com.masjidpulse.salat

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/** Replaces the previous rolling schedule atomically from the latest local settings. */
object AlertScheduler {
    const val ACTION_PRAYER_ALERT = "com.masjidpulse.salat.PRAYER_ALERT"
    const val EXTRA_DATE = "date"
    const val EXTRA_PRAYER = "prayer"
    const val EXTRA_TRIGGER = "trigger"

    data class Result(val count: Int, val exact: Boolean)

    fun scheduleAll(context: Context): Result {
        val appContext = context.applicationContext
        val preferences = AlertPreferences(appContext)
        val settings = preferences.load()
        val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        cancelScheduled(appContext, alarmManager, preferences.scheduledIds())
        if (!settings.configured) return Result(0, exactAllowed(alarmManager))

        val events = AlertPlanner.futureEnabled(
            PrayerCalculator.calculate(settings),
            settings,
            System.currentTimeMillis(),
        )
        val exact = exactAllowed(alarmManager)
        events.forEach { event ->
            val operation = pendingIntent(appContext, event, PendingIntent.FLAG_UPDATE_CURRENT)
            if (exact) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    event.triggerAtMillis,
                    operation,
                )
            } else {
                // Graceful fallback: Android may delay this alert until a maintenance window.
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    event.triggerAtMillis,
                    operation,
                )
            }
        }
        preferences.saveScheduledIds(events.map { it.id }.toSet())
        return Result(events.size, exact)
    }

    fun cancelAll(context: Context) {
        val preferences = AlertPreferences(context)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        cancelScheduled(context, alarmManager, preferences.scheduledIds())
        preferences.saveScheduledIds(emptySet())
    }

    fun exactAllowed(alarmManager: AlarmManager): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

    private fun cancelScheduled(context: Context, alarmManager: AlarmManager, ids: Set<String>) {
        ids.forEach { id ->
            val parts = id.split(":")
            if (parts.size != 2) return@forEach
            val event = PrayerEvent(parts[0], PrayerKey.valueOf(parts[1]), 0, "UTC")
            alarmManager.cancel(pendingIntent(context, event, PendingIntent.FLAG_UPDATE_CURRENT))
        }
    }

    private fun pendingIntent(context: Context, event: PrayerEvent, flags: Int): PendingIntent {
        val intent = Intent(context, AlertReceiver::class.java).apply {
            action = ACTION_PRAYER_ALERT
            data = Uri.parse("masjidpulse://salat/${event.date}/${event.prayer.name}")
            putExtra(EXTRA_DATE, event.date)
            putExtra(EXTRA_PRAYER, event.prayer.name)
            putExtra(EXTRA_TRIGGER, event.triggerAtMillis)
        }
        return PendingIntent.getBroadcast(
            context,
            event.id.hashCode(),
            intent,
            flags or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
