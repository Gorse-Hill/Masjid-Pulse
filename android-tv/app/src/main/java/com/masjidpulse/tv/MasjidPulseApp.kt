package com.masjidpulse.tv

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.util.Log
import kotlin.system.exitProcess

/** Restarts the display after an uncaught crash (with a crash-loop guard). */
class MasjidPulseApp : Application() {
    @SuppressLint("ApplySharedPref")
    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                Log.e(TAG, "Uncaught exception, scheduling restart", error)
                val prefs = getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE)
                val now = System.currentTimeMillis()
                val times = (prefs.getString(KEY_CRASHES, "") ?: "")
                    .split(',').mapNotNull { it.toLongOrNull() }.filter { now - it < 60_000 }
                // commit(), not apply(): it must be on disk before the process is killed
                prefs.edit().putString(KEY_CRASHES, (times + now).joinToString(",")).commit()
                if (ServerConfig.shouldRestart(times, now)) scheduleRestart(this, 2_000)
            } catch (_: Throwable) {
                // never throw from the crash handler
            }
            if (previous != null && BuildConfig.DEBUG) previous.uncaughtException(thread, error)
            Process.killProcess(Process.myPid())
            exitProcess(10)
        }
    }

    companion object {
        private const val TAG = "MasjidPulse"
        private const val KEY_CRASHES = "crash_times"

        fun scheduleRestart(context: Context, delayMs: Long) {
            val intent = Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            var flags = PendingIntent.FLAG_CANCEL_CURRENT
            if (Build.VERSION.SDK_INT >= 23) flags = flags or PendingIntent.FLAG_IMMUTABLE
            val pi = PendingIntent.getActivity(context, 1, intent, flags)
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.set(AlarmManager.RTC, System.currentTimeMillis() + delayMs, pi)
        }
    }
}
