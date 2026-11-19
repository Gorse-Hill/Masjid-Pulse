package com.masjidpulse.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader

/**
 * Full-screen shell around the TV web app that is BUNDLED in the APK (assets/tv), so the display
 * works offline from the very first launch. The configured server URL is passed to the page as
 * ?api=..., and the page caches the last published snapshot in WebView localStorage.
 */
class MainActivity : Activity() {
    private lateinit var container: FrameLayout
    private var webView: WebView? = null
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION") // still the simplest way that works from API 21 to 34
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
        )
        container = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(container)
        createWebView()
        loadDisplay()
        if (Prefs.serverUrl(this) == null) showSettings(firstRun = true)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        webView?.let { container.removeView(it); it.destroy() }
        val wv = WebView(this)
        wv.setBackgroundColor(Color.BLACK)
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // localStorage keeps the last snapshot + device token
            @Suppress("DEPRECATION")
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            // The page is served from https://appassets.androidplatform.net; allow a plain-http LAN server.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            @Deprecated("Deprecated in Java")
            override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(Uri.parse(url))

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The web renderer crashed or was killed for memory: rebuild the WebView, keep running.
                Log.w(TAG, "WebView renderer gone (crash=${Build.VERSION.SDK_INT >= 26 && detail.didCrash()}), recreating")
                container.post {
                    createWebView()
                    loadDisplay()
                }
                return true
            }
        }
        container.addView(wv, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        webView = wv
        hideSystemUi()
    }

    private fun loadDisplay() {
        val url = ServerConfig.tvPageUrl(Prefs.serverUrl(this))
        Log.i(TAG, "Loading $url")
        webView?.loadUrl(url)
        webView?.requestFocus()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    private var centerDownAt = 0L

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (code) {
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_BACK -> {
                    // BACK does not leave the display (kiosk); it opens settings, which has "Exit app".
                    if (event.repeatCount == 0) showSettings(firstRun = false)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                    if (event.repeatCount == 0) centerDownAt = event.downTime
                    if (event.eventTime - centerDownAt > 1500 && event.repeatCount > 0) {
                        centerDownAt = Long.MAX_VALUE / 2
                        showSettings(firstRun = false)
                        return true
                    }
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private var dialog: AlertDialog? = null

    private fun showSettings(firstRun: Boolean) {
        if (dialog?.isShowing == true) return
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            setText(Prefs.serverUrl(this@MainActivity) ?: "https://")
            setSelection(text.length)
        }
        val builder = AlertDialog.Builder(this)
            .setTitle(R.string.settings_title)
            .setMessage(R.string.settings_message)
            .setView(input)
            .setPositiveButton(R.string.save, null)
            .setNeutralButton(if (firstRun) R.string.cancel else R.string.exit_app) { _, _ -> if (!firstRun) finishAndRemoveTaskCompat() }
        if (!firstRun) builder.setNegativeButton(R.string.reset_pairing) { _, _ -> resetPairing() }
        val d = builder.create()
        d.setOnShowListener {
            d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val url = ServerConfig.normalize(input.text.toString())
                if (url == null) {
                    Toast.makeText(this, R.string.invalid_url, Toast.LENGTH_LONG).show()
                } else {
                    val changed = url != Prefs.serverUrl(this)
                    Prefs.setServerUrl(this, url)
                    d.dismiss()
                    if (changed) resetPairing() else loadDisplay()
                }
            }
        }
        d.setOnDismissListener { hideSystemUi(); webView?.requestFocus() }
        dialog = d
        d.show()
    }

    /** Forget the device token and cached snapshot (e.g. after moving to another server). */
    private fun resetPairing() {
        WebStorage.getInstance().deleteAllData()
        createWebView()
        loadDisplay()
    }

    private fun finishAndRemoveTaskCompat() = finishAndRemoveTask()

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        hideSystemUi()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MasjidPulse"
    }
}
