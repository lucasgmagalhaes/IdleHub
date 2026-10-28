package com.lucasgmagalhaes.idlehub.tabs

import org.junit.Assert.assertEquals
import org.junit.Test

class PixelBoundsTest {
    @Test
    fun convertsCssPixelsWithTheScreenDensity() {
        val bounds = PixelBounds.fromCss(10.0, 60.0, 360.0, 500.0, density = 3f, originX = 0, originY = 0)
        assertEquals(PixelBounds(30, 180, 1080, 1500), bounds)
    }

    @Test
    fun offsetsByWhereTheUiWebViewSits() {
        val bounds = PixelBounds.fromCss(0.0, 0.0, 100.0, 100.0, density = 2f, originX = 5, originY = 96)
        assertEquals(PixelBounds(5, 96, 200, 200), bounds)
    }

    @Test
    fun roundsFractionalDensities() {
        val bounds = PixelBounds.fromCss(1.0, 1.0, 10.0, 10.0, density = 2.625f, originX = 0, originY = 0)
        assertEquals(PixelBounds(3, 3, 26, 26), bounds)
    }

    @Test
    fun neverCollapsesToZeroSize() {
        val bounds = PixelBounds.fromCss(0.0, 0.0, 0.0, -5.0, density = 2f, originX = 0, originY = 0)
        assertEquals(1, bounds.width)
        assertEquals(1, bounds.height)
    }

    @Test
    fun parkedTabsStayOnePixelInTheCorner() {
        assertEquals(PixelBounds(0, 0, 1, 1), PixelBounds.PARKED)
    }
}
