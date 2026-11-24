package com.masjidpulse.salat

import com.batoulapps.adhan.CalculationMethod
import com.batoulapps.adhan.Coordinates
import com.batoulapps.adhan.HighLatitudeRule
import com.batoulapps.adhan.Madhab
import com.batoulapps.adhan.PrayerTimes
import com.batoulapps.adhan.data.DateComponents
import java.time.LocalDate
import java.time.ZoneId
import java.util.Date

/** Calculates a rolling offline timetable using the MIT-licensed Batoul Apps Adhan library. */
object PrayerCalculator {
    const val SCHEDULE_DAYS = 35

    fun calculate(
        settings: SalatSettings,
        startDate: LocalDate = LocalDate.now(ZoneId.of(settings.timezone)),
        days: Int = SCHEDULE_DAYS,
    ): List<PrayerEvent> {
        settings.validated()
        require(days in 1..366) { "Timetable must cover between 1 and 366 days" }
        val zone = ZoneId.of(settings.timezone)
        val coordinates = Coordinates(settings.latitude, settings.longitude)
        val events = mutableListOf<PrayerEvent>()

        repeat(days) { offset ->
            val date = startDate.plusDays(offset.toLong())
            val params = calculationMethod(settings.method).parameters.apply {
                madhab = if (settings.madhab == "HANAFI") Madhab.HANAFI else Madhab.SHAFI
                highLatitudeRule = when (settings.highLatitudeRule) {
                    "SEVENTH_OF_THE_NIGHT" -> HighLatitudeRule.SEVENTH_OF_THE_NIGHT
                    "TWILIGHT_ANGLE" -> HighLatitudeRule.TWILIGHT_ANGLE
                    else -> HighLatitudeRule.MIDDLE_OF_THE_NIGHT
                }
            }
            val times = PrayerTimes(
                coordinates,
                DateComponents(date.year, date.monthValue, date.dayOfMonth),
                params,
            )
            val values = listOf(
                PrayerKey.FAJR to times.fajr,
                PrayerKey.DHUHR to times.dhuhr,
                PrayerKey.ASR to times.asr,
                PrayerKey.MAGHRIB to times.maghrib,
                PrayerKey.ISHA to times.isha,
            )
            values.forEach { (key, value: Date?) ->
                requireNotNull(value) {
                    "Prayer times are unavailable for this location on $date; adjust the high-latitude rule"
                }
                // The library rounds to a minute but can retain the current milliseconds.
                val triggerAtMillis = value.time - Math.floorMod(value.time, 60_000L)
                events += PrayerEvent(date.toString(), key, triggerAtMillis, zone.id)
            }
        }
        return events.sortedBy { it.triggerAtMillis }
    }

    private fun calculationMethod(key: String): CalculationMethod = when (key) {
        "EGYPTIAN" -> CalculationMethod.EGYPTIAN
        "KARACHI" -> CalculationMethod.KARACHI
        "UMM_AL_QURA" -> CalculationMethod.UMM_AL_QURA
        "DUBAI" -> CalculationMethod.DUBAI
        "QATAR" -> CalculationMethod.QATAR
        "KUWAIT" -> CalculationMethod.KUWAIT
        "SINGAPORE" -> CalculationMethod.SINGAPORE
        "NORTH_AMERICA" -> CalculationMethod.NORTH_AMERICA
        "MOON_SIGHTING_COMMITTEE" -> CalculationMethod.MOON_SIGHTING_COMMITTEE
        else -> CalculationMethod.MUSLIM_WORLD_LEAGUE
    }
}

object AlertPlanner {
    fun futureEnabled(
        events: List<PrayerEvent>,
        settings: SalatSettings,
        nowMillis: Long,
    ): List<PrayerEvent> = events.filter {
        it.triggerAtMillis > nowMillis && settings.alerts[it.prayer]?.enabled == true
    }
}
