package com.masjidpulse.tv

import java.net.URI
import java.net.URLEncoder

/** Pure helpers for the configurable server URL (unit-tested on the JVM). */
object ServerConfig {
    /** Origin under which the bundled web app is served by WebViewAssetLoader. */
    const val ASSET_ORIGIN = "https://appassets.androidplatform.net"

    /**
     * Normalise user input to "scheme://host[:port][/path]" without a trailing slash or a trailing
     * "/tv" (people often paste the TV page URL). Adds https:// when no scheme is given.
     * Returns null when the input is not a usable http(s) URL.
     */
    fun normalize(input: String?): String? {
        var s = input?.trim().orEmpty()
        if (s.isEmpty()) return null
        if (!s.contains("://")) s = "https://$s"
        val uri = try {
            URI(s)
        } catch (e: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        if (host.isBlank() || host.contains(' ')) return null
        if (uri.rawQuery != null || uri.rawFragment != null) return null
        var path = (uri.rawPath ?: "").trimEnd('/')
        if (path.endsWith("/tv/index.html")) path = path.removeSuffix("/tv/index.html")
        if (path.endsWith("/tv")) path = path.removeSuffix("/tv")
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "$scheme://${host.lowercase()}$port$path"
    }

    /** URL of the bundled TV page, telling it which server to talk to. */
    fun tvPageUrl(server: String?): String {
        val base = "$ASSET_ORIGIN/tv/index.html"
        val s = normalize(server) ?: return base
        return "$base?api=" + URLEncoder.encode(s, "UTF-8")
    }

    /** Crash-loop guard: restart only if fewer than [max] crashes happened within [windowMs]. */
    fun shouldRestart(crashTimes: List<Long>, now: Long, max: Int = 3, windowMs: Long = 60_000): Boolean =
        crashTimes.count { now - it in 0..windowMs } < max
}
