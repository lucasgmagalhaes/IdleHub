package com.lucasgmagalhaes.idlehub.tabs

import android.webkit.WebView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs on a device or emulator. Checks the promise IdleHub makes on mobile:
 * a tab that is not on screen keeps running its game.
 */
@RunWith(AndroidJUnit4::class)
class GameWebViewsTest {
    // A "game" that counts timer ticks every 100 ms and stores data in its origin.
    private val game = "data:text/html," + java.net.URLEncoder.encode(
        "<script>window.ticks=0;setInterval(()=>window.ticks++,100)</script>", "UTF-8",
    ).replace("+", "%20")

    private lateinit var scenario: ActivityScenario<HostActivity>

    @Before
    fun launch() {
        scenario = ActivityScenario.launch(HostActivity::class.java)
    }

    @After
    fun close() {
        scenario.onActivity { it.games.closeAll() }
        scenario.close()
    }

    @Test
    fun parkedTabKeepsTheSameTimerRateAsTheVisibleOne() {
        scenario.onActivity {
            it.games.open("visible", game, "profile-visible", "")
            it.games.open("parked", game, "profile-parked", "")
            it.games.place("visible", GameWebViews.Css(0.0, 0.0, 300.0, 400.0))
            it.games.place("parked", null)
        }
        Thread.sleep(1_000)
        val visibleStart = ticks("visible")
        val parkedStart = ticks("parked")
        Thread.sleep(5_000)
        val visible = ticks("visible") - visibleStart
        val parked = ticks("parked") - parkedStart

        assertTrue("visible tab ran $visible ticks in 5 s", visible >= 40)
        assertTrue("parked tab ran $parked ticks in 5 s (visible: $visible)", parked >= visible * 0.8)
    }

    @Test
    fun tabsKeepRunningWhileTheAppIsInTheBackground() {
        scenario.onActivity { it.games.open("tab", game, "profile-bg", "") }
        Thread.sleep(1_000)
        val before = ticks("tab")

        scenario.moveToState(Lifecycle.State.CREATED) // activity stopped, like pressing Home
        Thread.sleep(10_000)
        scenario.moveToState(Lifecycle.State.RESUMED)
        val during = ticks("tab") - before

        // Browsers may slow timers of a background page, but the game must not stop.
        assertTrue("tab ran $during ticks in 10 s of background", during >= 8)
    }

    @Test
    fun accountsDoNotShareStorage() {
        val page = "https://example.com/"
        scenario.onActivity {
            it.games.open("a", page, "profile-a", "")
            it.games.open("b", page, "profile-b", "")
        }
        Thread.sleep(3_000)
        eval("a", "localStorage.setItem('who','a'); 'ok'")
        assertNotEquals("\"a\"", eval("b", "localStorage.getItem('who')"))
        assertEquals("\"a\"", eval("a", "localStorage.getItem('who')"))
    }

    @Test
    fun placingConvertsCssPixelsToTheScreen() {
        lateinit var view: WebView
        var density = 0f
        scenario.onActivity {
            it.games.open("tab", game, "profile-place", "")
            it.games.place("tab", GameWebViews.Css(10.0, 20.0, 100.0, 50.0))
            view = it.games.webViewOf("tab")!!
            density = it.resources.displayMetrics.density
        }
        scenario.onActivity {
            val params = view.layoutParams as android.widget.FrameLayout.LayoutParams
            assertEquals(Math.round(100 * density), params.width)
            assertEquals(Math.round(20 * density), params.topMargin)
        }
    }

    private fun ticks(id: String): Int = eval(id, "window.ticks").toInt()

    private fun eval(id: String, script: String): String {
        val latch = CountDownLatch(1)
        var result = ""
        scenario.onActivity { activity ->
            activity.games.webViewOf(id)!!.evaluateJavascript(script) {
                result = it
                latch.countDown()
            }
        }
        assertTrue("script did not finish", latch.await(5, TimeUnit.SECONDS))
        return result
    }
}
