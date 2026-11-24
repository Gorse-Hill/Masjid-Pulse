package com.masjidpulse.salat

import android.content.Context

/** Device-local settings only. No credentials or location history leave the phone. */
class AlertPreferences(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("salat_alerts", Context.MODE_PRIVATE)

    fun load(): SalatSettings {
        val defaults = SalatSettings()
        val alerts = PrayerKey.entries.associateWith { key ->
            PrayerAlertPreference(
                enabled = prefs.getBoolean("enabled_${key.name}", true),
                mode = runCatching {
                    AlertMode.valueOf(prefs.getString("mode_${key.name}", AlertMode.SOUND.name)!!)
                }.getOrDefault(AlertMode.SOUND),
            )
        }
        return SalatSettings(
            configured = prefs.getBoolean("configured", false),
            latitude = prefs.getFloat("latitude", defaults.latitude.toFloat()).toDouble(),
            longitude = prefs.getFloat("longitude", defaults.longitude.toFloat()).toDouble(),
            timezone = prefs.getString("timezone", defaults.timezone) ?: defaults.timezone,
            method = prefs.getString("method", defaults.method) ?: defaults.method,
            madhab = prefs.getString("madhab", defaults.madhab) ?: defaults.madhab,
            highLatitudeRule = prefs.getString("high_latitude", defaults.highLatitudeRule)
                ?: defaults.highLatitudeRule,
            adhanUri = prefs.getString("adhan_uri", null),
            adhanName = prefs.getString("adhan_name", null),
            alerts = alerts,
        )
    }

    fun save(settings: SalatSettings) {
        prefs.edit().apply {
            putBoolean("configured", settings.configured)
            putFloat("latitude", settings.latitude.toFloat())
            putFloat("longitude", settings.longitude.toFloat())
            putString("timezone", settings.timezone)
            putString("method", settings.method)
            putString("madhab", settings.madhab)
            putString("high_latitude", settings.highLatitudeRule)
            putString("adhan_uri", settings.adhanUri)
            putString("adhan_name", settings.adhanName)
            settings.alerts.forEach { (key, alert) ->
                putBoolean("enabled_${key.name}", alert.enabled)
                putString("mode_${key.name}", alert.mode.name)
            }
        }.apply()
    }

    fun scheduledIds(): Set<String> = prefs.getStringSet("scheduled_ids", emptySet()) ?: emptySet()

    fun saveScheduledIds(ids: Set<String>) {
        prefs.edit().putStringSet("scheduled_ids", ids).apply()
    }
}
