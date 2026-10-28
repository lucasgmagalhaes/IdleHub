package com.lucasgmagalhaes.idlehub.tabs

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

// Argument classes mirror `crates/tauri-plugin-tabs/src/models.rs`.

@InvokeArg
class OpenArgs {
    var id: String = ""
    var url: String = ""
    var profile: String = ""
    var initScript: String = ""
}

@InvokeArg
class BoundsArgs {
    var x: Double = 0.0
    var y: Double = 0.0
    var width: Double = 0.0
    var height: Double = 0.0
}

@InvokeArg
class PlaceArgs {
    var id: String = ""
    var bounds: BoundsArgs? = null
}

@InvokeArg
class PolicyArgs {
    var id: String = ""
    var script: String = ""
}

@InvokeArg
class TabArgs {
    var id: String = ""
}

@InvokeArg
class KeepAliveArgs {
    var activeTabs: Int = 0
    var title: String = ""
    var text: String = ""
}

@TauriPlugin
class TabsPlugin(private val activity: Activity) : Plugin(activity) {
    private var games: GameWebViews? = null

    override fun load(webView: WebView) {
        games = GameWebViews(activity, webView)
    }

    @Command
    fun open(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        onUiThread(invoke) { it.open(args.id, args.url, args.profile, args.initScript) }
    }

    @Command
    fun place(invoke: Invoke) {
        val args = invoke.parseArgs(PlaceArgs::class.java)
        val css = args.bounds?.let { GameWebViews.Css(it.x, it.y, it.width, it.height) }
        onUiThread(invoke) { it.place(args.id, css) }
    }

    @Command
    fun applyPolicy(invoke: Invoke) {
        val args = invoke.parseArgs(PolicyArgs::class.java)
        onUiThread(invoke) { it.applyPolicy(args.id, args.script) }
    }

    @Command
    fun reload(invoke: Invoke) {
        val args = invoke.parseArgs(TabArgs::class.java)
        onUiThread(invoke) { it.reload(args.id) }
    }

    @Command
    fun close(invoke: Invoke) {
        val args = invoke.parseArgs(TabArgs::class.java)
        onUiThread(invoke) { it.close(args.id) }
    }

    @Command
    fun keepAlive(invoke: Invoke) {
        val args = invoke.parseArgs(KeepAliveArgs::class.java)
        if (args.activeTabs > 0) requestNotificationPermission()
        KeepAliveService.update(activity, args.activeTabs, args.title, args.text)
        invoke.resolve()
    }

    override fun onDestroy() {
        games?.closeAll()
        KeepAliveService.update(activity, 0, "", "")
    }

    /** The service notification is hidden on Android 13+ until the user allows notifications. */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val permission = Manifest.permission.POST_NOTIFICATIONS
        if (ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(activity, arrayOf(permission), 0)
        }
    }

    private fun onUiThread(invoke: Invoke, action: (GameWebViews) -> Unit) {
        activity.runOnUiThread {
            val games = games
            if (games == null) {
                invoke.reject("The UI webview is not ready yet")
                return@runOnUiThread
            }
            try {
                action(games)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }
}
