package com.masjidpulse.salat

import java.time.ZoneId

/** The five daily prayers for which a user can independently choose an alert. */
enum class PrayerKey(val displayName: String) {
    FAJR("Fajr"),
    DHUHR("Dhuhr"),
    ASR("Asr"),
    MAGHRIB("Maghrib"),
    ISHA("Isha"),
}

enum class AlertMode(val label: String) {
    SILENT("Silent notification"),
    SOUND("Notification sound"),
    ADHAN("Play selected Adhan"),
}

data class PrayerAlertPreference(
    val enabled: Boolean = true,
    val mode: AlertMode = AlertMode.SOUND,
)

data class SalatSettings(
    val configured: Boolean = false,
    val latitude: Double = 2.0469,
    val longitude: Double = 45.3182,
    val timezone: String = ZoneId.systemDefault().id,
    val method: String = "MUSLIM_WORLD_LEAGUE",
    val madhab: String = "SHAFI",
    val highLatitudeRule: String = "MIDDLE_OF_THE_NIGHT",
    val adhanUri: String? = null,
    val adhanName: String? = null,
    val alerts: Map<PrayerKey, PrayerAlertPreference> = PrayerKey.entries.associateWith {
        PrayerAlertPreference()
    },
) {
    fun validated(): SalatSettings {
        require(latitude in -90.0..90.0) { "Latitude must be between -90 and 90" }
        require(longitude in -180.0..180.0) { "Longitude must be between -180 and 180" }
        try {
            ZoneId.of(timezone)
        } catch (_: Exception) {
            throw IllegalArgumentException("Enter a valid IANA timezone, such as Africa/Mogadishu")
        }
        require(alerts.values.any { it.enabled }) { "Enable at least one prayer alert" }
        return this
    }
}

data class PrayerEvent(
    val date: String,
    val prayer: PrayerKey,
    val triggerAtMillis: Long,
    val timezone: String,
) {
    val id: String = "$date:${prayer.name}"
}

data class MethodOption(val key: String, val label: String)

val CALCULATION_METHODS = listOf(
    MethodOption("MUSLIM_WORLD_LEAGUE", "Muslim World League"),
    MethodOption("EGYPTIAN", "Egyptian General Authority of Survey"),
    MethodOption("KARACHI", "University of Islamic Sciences, Karachi"),
    MethodOption("UMM_AL_QURA", "Umm al-Qura University, Makkah"),
    MethodOption("DUBAI", "Dubai / Gulf region"),
    MethodOption("QATAR", "Qatar"),
    MethodOption("KUWAIT", "Kuwait"),
    MethodOption("SINGAPORE", "Singapore"),
    MethodOption("NORTH_AMERICA", "North America (ISNA)"),
    MethodOption("MOON_SIGHTING_COMMITTEE", "Moonsighting Committee"),
)
