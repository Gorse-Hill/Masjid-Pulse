package com.masjidpulse.salat

import android.app.Application

class SalatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannels(this)
    }
}
