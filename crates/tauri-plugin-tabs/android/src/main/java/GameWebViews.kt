package com.lucasgmagalhaes.idlehub.tabs

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Build
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Owns the game webviews and lays them over the app's UI webview.
 *
 * Every tab stays attached to the window for its whole life: the visible one
 * fills its pane, the others are parked at 1×1 px. Nothing is ever paused,
 * hidden or detached, because any of those makes the WebView throttle the game.
 */
class GameWebViews(private val activity: Activity, private val uiWebView: WebView) {
    private class Tab(
        val url: String,
        val profile: String,
        val initScript: String,
        var webView: WebView,
        var bounds: PixelBounds = PixelBounds.PARKED,
        var policyScript: String? = null,
    )

    private val tabs = mutableMapOf<String, Tab>()
    private val layer = FrameLayout(activity)

    val size: Int
        get() = tabs.size

    fun open(id: String, url: String, profile: String, initScript: String) {
        if (tabs.containsKey(id)) return
        attachLayer()
        val tab = Tab(url, profile, initScript, createWebView(id, profile, initScript))
        tabs[id] = tab
        layer.addView(tab.webView, layoutParams(tab.bounds))
        tab.webView.loadUrl(url)
    }

    /** [css] is in CSS pixels of the UI webview; `null` parks the tab. */
    fun place(id: String, css: Css?) {
        val tab = tabs[id] ?: return
        tab.bounds = css?.let {
            PixelBounds.fromCss(
                it.x, it.y, it.width, it.height,
                activity.resources.displayMetrics.density,
                uiWebView.left, uiWebView.top,
            )
        } ?: PixelBounds.PARKED
        tab.webView.layoutParams = layoutParams(tab.bounds)
        if (css != null) tab.webView.bringToFront()
    }

    /** Runs [script] now and again after every page load (a reload resets the page runtime). */
    fun applyPolicy(id: String, script: String) {
        val tab = tabs[id] ?: return
        tab.policyScript = script
        tab.webView.evaluateJavascript(script, null)
    }

    fun reload(id: String) {
        tabs[id]?.webView?.reload()
    }

    fun close(id: String) {
        val tab = tabs.remove(id) ?: return
        layer.removeView(tab.webView)
        tab.webView.destroy()
    }

    fun closeAll() {
        tabs.keys.toList().forEach(::close)
    }

    /** For tests: the live webview of a tab. */
    internal fun webViewOf(id: String): WebView? = tabs[id]?.webView

    private fun attachLayer() {
        if (layer.parent != null) return
        // Same parent as the UI webview, above it. Touches outside the game
        // webviews fall through to the UI because the layer itself is not clickable.
        (uiWebView.parent as ViewGroup).addView(
            layer,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(id: String, profile: String, initScript: String): WebView {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            "This Android System WebView cannot isolate accounts. Update it from the Play Store."
        }
        val webView = WebView(activity)
        // Must happen before anything is loaded into the webview.
        ProfileStore.getInstance().getOrCreateProfile(profile)
        WebViewCompat.setProfile(webView, profile)
        WebViewCompat.getProfile(webView).cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Keep hidden tabs' renderers from being killed under memory pressure.
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        }
        val documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (documentStart) WebViewCompat.addDocumentStartJavaScript(webView, initScript, setOf("*"))

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                if (!documentStart) view.evaluateJavascript(initScript, null)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                tabs[id]?.policyScript?.let { view.evaluateJavascript(it, null) }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate(id)
                return true
            }
        }
        return webView
    }

    /** The renderer died (crash or OOM kill); a WebView cannot be reused after that. */
    private fun recreate(id: String) {
        val tab = tabs[id] ?: return
        layer.removeView(tab.webView)
        tab.webView.destroy()
        tab.webView = createWebView(id, tab.profile, tab.initScript)
        layer.addView(tab.webView, layoutParams(tab.bounds))
        tab.webView.loadUrl(tab.url)
    }

    private fun layoutParams(bounds: PixelBounds) =
        FrameLayout.LayoutParams(bounds.width, bounds.height).apply {
            leftMargin = bounds.left
            topMargin = bounds.top
        }

    /** A rect in CSS pixels of the UI webview. */
    data class Css(val x: Double, val y: Double, val width: Double, val height: Double)
}
