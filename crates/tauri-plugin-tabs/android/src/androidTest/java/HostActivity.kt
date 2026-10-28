package com.lucasgmagalhaes.idlehub.tabs

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.widget.FrameLayout

/** Stands in for the Tauri activity: a full-screen "UI" webview inside a FrameLayout. */
class HostActivity : Activity() {
    lateinit var ui: WebView
    lateinit var games: GameWebViews

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        ui = WebView(this)
        root.addView(ui, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        games = GameWebViews(this, ui)
    }
}
