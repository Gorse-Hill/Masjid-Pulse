package com.masjidpulse.salat

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.provider.Settings
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var preferences: AlertPreferences
    private lateinit var prayerRows: Map<PrayerKey, Pair<CheckBox, Spinner>>
    private var displayEvents: List<PrayerEvent> = emptyList()
    private var selectedAdhanName: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())
    private val countdown = object : Runnable {
        override fun run() {
            renderNextPrayer()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        preferences = AlertPreferences(this)
        NotificationHelper.createChannels(this)
        buildPrayerRows()
        wireControls()
        populate(preferences.load())
    }

    override fun onResume() {
        super.onResume()
        val settings = preferences.load()
        if (settings.configured) {
            runCatching { AlertScheduler.scheduleAll(this) }
                .onSuccess { renderSettingsStatus(it.count, it.exact) }
                .onFailure { renderSettingsStatus(0, false, it.message) }
        } else {
            renderSettingsStatus(0, false)
        }
        refreshTimes()
        handler.post(countdown)
    }

    override fun onPause() {
        handler.removeCallbacks(countdown)
        super.onPause()
    }

    private fun buildPrayerRows() {
        val container = findViewById<LinearLayout>(R.id.prayer_alerts_container)
        val modes = AlertMode.entries.map { it.label }
        prayerRows = PrayerKey.entries.associateWith { key ->
            val row = layoutInflater.inflate(R.layout.item_prayer_alert, container, false)
            val enabled = row.findViewById<CheckBox>(R.id.prayer_enabled)
            val mode = row.findViewById<Spinner>(R.id.prayer_mode)
            enabled.text = key.displayName
            mode.adapter = spinnerAdapter(modes)
            mode.contentDescription = "${key.displayName} alert style"
            container.addView(row)
            enabled to mode
        }
    }

    private fun wireControls() {
        findViewById<Button>(R.id.use_location).setOnClickListener { requestLocation() }
        findViewById<Button>(R.id.find_city).setOnClickListener { findCity() }
        findViewById<Button>(R.id.select_adhan).setOnClickListener { chooseAdhan() }
        findViewById<Button>(R.id.allow_notifications).setOnClickListener { requestNotifications() }
        findViewById<Button>(R.id.allow_exact_alarms).setOnClickListener { requestExactAlarms() }
        findViewById<Button>(R.id.save_alerts).setOnClickListener { saveAndSchedule() }
        findViewById<Button>(R.id.test_alert).setOnClickListener { sendTestAlert() }
    }

    private fun populate(settings: SalatSettings) {
        edit(R.id.latitude).setText(settings.latitude.toString())
        edit(R.id.longitude).setText(settings.longitude.toString())
        edit(R.id.timezone).setText(settings.timezone)
        spinner(R.id.calculation_method).adapter = spinnerAdapter(CALCULATION_METHODS.map { it.label })
        spinner(R.id.calculation_method).setSelection(
            CALCULATION_METHODS.indexOfFirst { it.key == settings.method }.coerceAtLeast(0),
        )
        spinner(R.id.asr_method).adapter = spinnerAdapter(
            listOf("Shafi'i / Maliki / Hanbali (standard)", "Hanafi (later Asr)"),
        )
        spinner(R.id.asr_method).setSelection(if (settings.madhab == "HANAFI") 1 else 0)
        spinner(R.id.high_latitude).adapter = spinnerAdapter(
            listOf("Middle of the night (recommended)", "One seventh of the night", "Twilight angle"),
        )
        spinner(R.id.high_latitude).setSelection(
            when (settings.highLatitudeRule) {
                "SEVENTH_OF_THE_NIGHT" -> 1
                "TWILIGHT_ANGLE" -> 2
                else -> 0
            },
        )
        prayerRows.forEach { (key, row) ->
            val preference = settings.alerts[key] ?: PrayerAlertPreference()
            row.first.isChecked = preference.enabled
            row.second.setSelection(AlertMode.entries.indexOf(preference.mode))
        }
        selectedAdhanName = settings.adhanName
        renderAdhanSelection()
    }

    private fun readSettings(configured: Boolean): SalatSettings {
        val current = preferences.load()
        return SalatSettings(
            configured = configured,
            latitude = edit(R.id.latitude).text.toString().toDoubleOrNull()
                ?: throw IllegalArgumentException("Enter a valid latitude"),
            longitude = edit(R.id.longitude).text.toString().toDoubleOrNull()
                ?: throw IllegalArgumentException("Enter a valid longitude"),
            timezone = edit(R.id.timezone).text.toString().trim(),
            method = CALCULATION_METHODS[spinner(R.id.calculation_method).selectedItemPosition].key,
            madhab = if (spinner(R.id.asr_method).selectedItemPosition == 1) "HANAFI" else "SHAFI",
            highLatitudeRule = when (spinner(R.id.high_latitude).selectedItemPosition) {
                1 -> "SEVENTH_OF_THE_NIGHT"
                2 -> "TWILIGHT_ANGLE"
                else -> "MIDDLE_OF_THE_NIGHT"
            },
            adhanUri = current.adhanUri,
            adhanName = current.adhanName,
            alerts = prayerRows.mapValues { (_, row) ->
                PrayerAlertPreference(row.first.isChecked, AlertMode.entries[row.second.selectedItemPosition])
            },
        ).validated()
    }

    private fun saveAndSchedule() {
        runCatching {
            val settings = readSettings(configured = true)
            preferences.save(settings)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
            }
            AlertScheduler.scheduleAll(this)
        }.onSuccess { result ->
            populate(preferences.load())
            refreshTimes()
            renderSettingsStatus(result.count, result.exact)
            toast("${result.count} prayer alerts saved. They work offline on this phone.")
        }.onFailure { toast(it.message ?: "Could not save alerts") }
    }

    private fun sendTestAlert() {
        runCatching { readSettings(configured = true) }.onSuccess { settings ->
            val enabled = settings.alerts.entries.firstOrNull { it.value.enabled }
            if (enabled == null) {
                toast("Enable at least one prayer alert first")
                return@onSuccess
            }
            val playsAdhan = enabled.value.mode == AlertMode.ADHAN && !settings.adhanUri.isNullOrBlank()
            if (!playsAdhan && !notificationsAllowed()) {
                toast("Allow notifications before testing this alert style")
                return@onSuccess
            }
            val event = PrayerEvent(
                java.time.LocalDate.now(ZoneId.of(settings.timezone)).toString(),
                enabled.key,
                System.currentTimeMillis(),
                settings.timezone,
            )
            NotificationHelper.deliver(this, event, enabled.value.mode, test = true)
            val prayer = enabled.key.displayName.lowercase()
            toast(if (playsAdhan) "Test $prayer Adhan playback started" else "Test $prayer notification sent")
        }.onFailure { toast(it.message ?: "Check your settings first") }
    }

    private fun notificationsAllowed(): Boolean {
        val manager = getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    }

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        } else if (!notificationsAllowed()) {
            runCatching {
                startActivity(
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
                )
            }.onFailure { toast("Open system settings and enable Masjid Pulse notifications") }
        } else {
            toast("Notifications are allowed")
        }
    }

    private fun requestExactAlarms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            toast("Exact alarms are available on this Android version")
            return
        }
        val manager = getSystemService(AlarmManager::class.java)
        if (manager.canScheduleExactAlarms()) {
            toast("Exact alarms are allowed")
            return
        }
        runCatching {
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).setData(Uri.parse("package:$packageName")))
        }.onFailure { toast("Open system settings and allow Alarms & reminders for Masjid Pulse") }
    }

    private fun requestLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION),
                REQUEST_LOCATION,
            )
        } else {
            locateDevice()
        }
    }

    @Suppress("DEPRECATION")
    private fun locateDevice() {
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        val manager = getSystemService(LocationManager::class.java)
        val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .firstOrNull { manager.getProviders(true).contains(it) }
        if (provider == null) {
            toast("Turn on location services or enter a city manually")
            return
        }
        toast("Finding your location…")
        val listener: (Location) -> Unit = { location -> applyLocation(location) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            manager.getCurrentLocation(provider, null, mainExecutor) { location ->
                if (location == null) toast("Location unavailable; enter your city or coordinates")
                else listener(location)
            }
        } else {
            manager.requestSingleUpdate(
                provider,
                object : LocationListener {
                    override fun onLocationChanged(location: Location) = listener(location)
                    override fun onProviderDisabled(provider: String) {
                        toast("Location provider unavailable; enter coordinates manually")
                    }
                },
                Looper.getMainLooper(),
            )
        }
    }

    private fun applyLocation(location: Location) {
        edit(R.id.latitude).setText(getString(R.string.coordinate_value, location.latitude))
        edit(R.id.longitude).setText(getString(R.string.coordinate_value, location.longitude))
        edit(R.id.timezone).setText(ZoneId.systemDefault().id)
        toast("Location found. Check the timezone, then Save & schedule alerts.")
    }

    private fun findCity() {
        val query = edit(R.id.city).text.toString().trim()
        if (query.isEmpty()) {
            toast("Enter a city name")
            return
        }
        if (!Geocoder.isPresent()) {
            toast("City search is unavailable; enter coordinates manually")
            return
        }
        val geocoder = Geocoder(this, Locale.getDefault())
        toast("Searching for $query…")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            geocoder.getFromLocationName(query, 1) { addresses -> applyCity(addresses.firstOrNull()) }
        } else {
            Thread {
                val address = runCatching {
                    @Suppress("DEPRECATION")
                    geocoder.getFromLocationName(query, 1)?.firstOrNull()
                }.getOrNull()
                runOnUiThread { applyCity(address) }
            }.start()
        }
    }

    private fun applyCity(address: android.location.Address?) {
        if (address == null) {
            toast("City not found. Check the spelling or enter coordinates manually.")
            return
        }
        edit(R.id.latitude).setText(getString(R.string.coordinate_value, address.latitude))
        edit(R.id.longitude).setText(getString(R.string.coordinate_value, address.longitude))
        toast("Location filled. Verify the timezone, then Save & schedule alerts.")
    }

    private fun chooseAdhan() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "audio/*"
        }
        startActivityForResult(intent, REQUEST_ADHAN)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_ADHAN || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        runCatching {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        val current = preferences.load()
        selectedAdhanName = audioName(uri)
        preferences.save(current.copy(adhanUri = uri.toString(), adhanName = selectedAdhanName))
        renderAdhanSelection()
        toast("Adhan audio selected. Save alerts to apply it.")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_LOCATION && grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
            locateDevice()
        }
        if (requestCode == REQUEST_NOTIFICATIONS) {
            toast(if (grantResults.any { it == PackageManager.PERMISSION_GRANTED })
                "Notifications allowed" else "Notifications are blocked; prayer alerts may not be visible")
        }
    }

    private fun refreshTimes() {
        val settings = preferences.load()
        val container = findViewById<LinearLayout>(R.id.today_times_container)
        container.removeAllViews()
        if (!settings.configured) {
            displayEvents = emptyList()
            container.addView(bodyText("Save your location and alert preferences to see today’s times."))
            renderNextPrayer()
            return
        }
        runCatching { PrayerCalculator.calculate(settings, days = 2) }
            .onSuccess { events ->
                displayEvents = events
                val today = java.time.LocalDate.now(ZoneId.of(settings.timezone)).toString()
                events.filter { it.date == today }.forEach { event ->
                    val preference = settings.alerts[event.prayer] ?: PrayerAlertPreference()
                    container.addView(
                        bodyText(
                            "${event.prayer.displayName}   ${timeFormatter.format(Instant.ofEpochMilli(event.triggerAtMillis).atZone(ZoneId.of(event.timezone)))}" +
                                if (preference.enabled) "  ·  ${preference.mode.label}" else "  ·  Off",
                        ),
                    )
                }
            }
            .onFailure { container.addView(bodyText(it.message ?: "Prayer times unavailable")) }
        renderNextPrayer()
    }

    private fun renderNextPrayer() {
        val next = displayEvents.firstOrNull { it.triggerAtMillis > System.currentTimeMillis() }
        val label = findViewById<TextView>(R.id.next_prayer)
        if (next == null) {
            label.setText(R.string.not_configured)
            return
        }
        val remaining = ((next.triggerAtMillis - System.currentTimeMillis()) / 1000).coerceAtLeast(0)
        val hours = remaining / 3600
        val minutes = (remaining % 3600) / 60
        val seconds = remaining % 60
        val time = timeFormatter.format(Instant.ofEpochMilli(next.triggerAtMillis).atZone(ZoneId.of(next.timezone)))
        label.text = getString(
            R.string.next_prayer_countdown,
            next.prayer.displayName,
            time,
            hours,
            minutes,
            seconds,
        )
    }

    private fun renderSettingsStatus(count: Int, exact: Boolean, error: String? = null) {
        val notifications = notificationsAllowed()
        findViewById<TextView>(R.id.alert_status).text = when {
            error != null -> "Scheduling needs attention: $error"
            !preferences.load().configured -> "Alerts are not scheduled yet."
            else -> buildString {
                append("$count alerts scheduled on this device. ")
                append(if (notifications) "Notifications allowed. " else "Notifications blocked. ")
                append(if (exact) "Exact alarm timing allowed." else "Approximate timing: allow exact alarms for on-time alerts.")
            }
        }
    }

    private fun renderAdhanSelection() {
        findViewById<TextView>(R.id.adhan_file).text = selectedAdhanName?.let {
            getString(R.string.selected_adhan, it)
        } ?: getString(R.string.no_adhan_selected)
    }

    private fun audioName(uri: Uri): String {
        contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) return cursor.getString(index)
        }
        return uri.lastPathSegment ?: "Selected audio"
    }

    private fun spinnerAdapter(items: List<String>) = ArrayAdapter(
        this,
        android.R.layout.simple_spinner_item,
        items,
    ).apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }

    private fun bodyText(value: String): TextView = TextView(this).apply {
        text = value
        textSize = 16f
        setTextColor(getColor(R.color.pulse_ink))
        setPadding(0, 12, 0, 12)
    }

    private fun edit(id: Int): EditText = findViewById(id)
    private fun spinner(id: Int): Spinner = findViewById(id)
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    companion object {
        private const val REQUEST_LOCATION = 31
        private const val REQUEST_NOTIFICATIONS = 32
        private const val REQUEST_ADHAN = 33
    }
}
