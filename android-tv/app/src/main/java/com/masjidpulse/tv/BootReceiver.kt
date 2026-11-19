package com.masjidpulse.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Starts the display when the TV boots (power cuts are common). On Android 10+ the system only
 * allows this if the app has "Display over other apps" permission; see android-tv/README.md.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            Log.i("MasjidPulse", "Auto-start after $action")
            try {
                context.startActivity(
                    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (e: Exception) {
                // Fall back to an alarm-based start (also subject to background-start limits).
                MasjidPulseApp.scheduleRestart(context, 1_000)
            }
        }
    }
}
