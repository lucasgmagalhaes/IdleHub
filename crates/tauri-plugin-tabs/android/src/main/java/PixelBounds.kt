package com.lucasgmagalhaes.idlehub.tabs

/** Where a game webview goes, in physical pixels of the layout shared with the UI webview. */
data class PixelBounds(val left: Int, val top: Int, val width: Int, val height: Int) {
    companion object {
        /**
         * Tabs without a pane are shrunk to one pixel instead of hidden: a View that
         * is GONE or INVISIBLE makes the WebView throttle its timers.
         */
        val PARKED = PixelBounds(0, 0, 1, 1)

        /** Converts a rect in CSS px of the UI webview, which sits at [originX], [originY]. */
        fun fromCss(
            x: Double,
            y: Double,
            width: Double,
            height: Double,
            density: Float,
            originX: Int,
            originY: Int,
        ): PixelBounds {
            fun px(value: Double) = Math.round(value * density).toInt()
            return PixelBounds(originX + px(x), originY + px(y), maxOf(1, px(width)), maxOf(1, px(height)))
        }
    }
}
