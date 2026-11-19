package com.masjidpulse.tv

import android.content.Context

object Prefs {
    const val FILE = "masjid_pulse"
    private const val KEY_SERVER = "server_url"

    fun serverUrl(context: Context): String? =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY_SERVER, null)
            ?: ServerConfig.normalize(BuildConfig.DEFAULT_SERVER_URL)

    fun setServerUrl(context: Context, url: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY_SERVER, url).apply()
    }
}
