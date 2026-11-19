package com.masjidpulse.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerConfigTest {
    @Test fun addsHttpsAndStripsTrailingSlash() {
        assertEquals("https://pulse.example.org", ServerConfig.normalize(" pulse.example.org/ "))
    }

    @Test fun keepsHttpPortAndPathButStripsTvPage() {
        assertEquals("http://192.168.1.20:3000", ServerConfig.normalize("http://192.168.1.20:3000/tv/"))
        assertEquals("http://192.168.1.20:3000", ServerConfig.normalize("http://192.168.1.20:3000/tv/index.html"))
        assertEquals("https://example.org/pulse", ServerConfig.normalize("https://Example.ORG/pulse/"))
    }

    @Test fun rejectsInvalidInput() {
        assertNull(ServerConfig.normalize(""))
        assertNull(ServerConfig.normalize(null))
        assertNull(ServerConfig.normalize("ftp://example.org"))
        assertNull(ServerConfig.normalize("https://"))
        assertNull(ServerConfig.normalize("https://exa mple.org"))
        assertNull(ServerConfig.normalize("https://example.org/?a=1"))
    }

    @Test fun buildsBundledPageUrl() {
        assertEquals(
            "https://appassets.androidplatform.net/tv/index.html?api=http%3A%2F%2F10.0.2.2%3A3000",
            ServerConfig.tvPageUrl("http://10.0.2.2:3000"),
        )
        assertEquals("https://appassets.androidplatform.net/tv/index.html", ServerConfig.tvPageUrl(null))
    }

    @Test fun crashLoopGuard() {
        val now = 1_000_000L
        assertTrue(ServerConfig.shouldRestart(emptyList(), now))
        assertTrue(ServerConfig.shouldRestart(listOf(now - 5_000, now - 120_000, now - 130_000), now))
        assertFalse(ServerConfig.shouldRestart(listOf(now - 1_000, now - 2_000, now - 3_000), now))
    }
}
