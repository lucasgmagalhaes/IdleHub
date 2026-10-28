import CoreGraphics

/// Where a game webview goes, in points of the view shared with the UI webview.
enum CssFrame {
    /// Tabs without a pane are shrunk to one point instead of hidden: a hidden
    /// or detached WKWebView gets its timers throttled or suspended.
    static let parked = CGRect(x: 0, y: 0, width: 1, height: 1)

    /// The UI uses `width=device-width`, so one CSS pixel is one point; only the
    /// UI webview's position inside its superview is added.
    static func frame(x: Double, y: Double, width: Double, height: Double, origin: CGPoint) -> CGRect {
        CGRect(x: origin.x + x, y: origin.y + y, width: max(1, width), height: max(1, height))
    }
}
