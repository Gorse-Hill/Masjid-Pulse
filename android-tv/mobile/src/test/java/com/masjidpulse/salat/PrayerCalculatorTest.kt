package com.masjidpulse.salat

import java.time.LocalDate
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PrayerCalculatorTest {
    private val settings = SalatSettings(
        configured = true,
        latitude = -1.2921,
        longitude = 36.8219,
        timezone = "Africa/Nairobi",
    )

    @Test
    fun `calculates five ordered prayers for the full offline window`() {
        val events = PrayerCalculator.calculate(settings, LocalDate.of(2026, 11, 22))
        assertEquals(PrayerCalculator.SCHEDULE_DAYS * 5, events.size)
        assertEquals(events.sortedBy { it.triggerAtMillis }, events)
        events.groupBy { it.date }.values.forEach { day ->
            assertEquals(PrayerKey.entries.toList(), day.map { it.prayer })
            assertTrue(day.zipWithNext().all { (a, b) -> a.triggerAtMillis < b.triggerAtMillis })
        }
    }

    @Test
    fun `every offered calculation method produces a complete day`() {
        CALCULATION_METHODS.forEach { method ->
            val events = PrayerCalculator.calculate(
                settings.copy(method = method.key),
                LocalDate.of(2026, 11, 22),
                days = 1,
            )
            assertEquals(method.label, 5, events.size)
            assertEquals(PrayerKey.entries.toSet(), events.map { it.prayer }.toSet())
        }
    }

    @Test
    fun `planner excludes past and disabled prayer alerts`() {
        val now = 1_000_000L
        val events = listOf(
            PrayerEvent("2026-11-22", PrayerKey.FAJR, now - 1, "Africa/Nairobi"),
            PrayerEvent("2026-11-22", PrayerKey.DHUHR, now + 1, "Africa/Nairobi"),
            PrayerEvent("2026-11-22", PrayerKey.ASR, now + 2, "Africa/Nairobi"),
        )
        val configured = settings.copy(
            alerts = settings.alerts + (PrayerKey.ASR to PrayerAlertPreference(false)),
        )
        val planned = AlertPlanner.futureEnabled(events, configured, now)
        assertEquals(listOf(PrayerKey.DHUHR), planned.map { it.prayer })
    }

    @Test
    fun `calculation is independent of the phone default timezone`() {
        val original = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
            val first = PrayerCalculator.calculate(settings, LocalDate.of(2026, 11, 22), days = 1)
            TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Auckland"))
            val second = PrayerCalculator.calculate(settings, LocalDate.of(2026, 11, 22), days = 1)
            assertEquals(first.map { it.triggerAtMillis }, second.map { it.triggerAtMillis })
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects coordinates outside the valid range`() {
        settings.copy(latitude = 91.0).validated()
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects an invalid timezone before scheduling`() {
        settings.copy(timezone = "not-a-zone").validated()
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects disabling every prayer`() {
        settings.copy(
            alerts = PrayerKey.entries.associateWith { PrayerAlertPreference(enabled = false) },
        ).validated()
    }
}
