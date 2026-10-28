import UIKit
import WebKit

enum TabsError: LocalizedError {
    case invalidUrl(String)
    case invalidProfile(String)
    case noSuperview
    case unsupportedSystem

    var errorDescription: String? {
        switch self {
        case .invalidUrl(let url): return "Invalid address: \(url)"
        case .invalidProfile(let profile): return "Invalid profile id: \(profile)"
        case .noSuperview: return "The UI webview is not in a view hierarchy yet"
        case .unsupportedSystem: return "IdleHub needs iOS 17 or later to keep accounts separate"
        }
    }
}

/// Owns the game webviews and lays them over the app's UI webview.
///
/// Every tab stays in the view hierarchy for its whole life: the visible one
/// fills its pane, the others are parked at 1×1 pt behind it. Nothing is hidden
/// or removed, because WebKit suspends pages that are not in a visible window.
final class GameWebViews: NSObject, WKNavigationDelegate {
    private final class Tab {
        let url: URL
        let profile: UUID
        let initScript: String
        var webView: WKWebView
        var frame = CssFrame.parked
        var policyScript: String?

        init(url: URL, profile: UUID, initScript: String, webView: WKWebView) {
            self.url = url
            self.profile = profile
            self.initScript = initScript
            self.webView = webView
        }
    }

    private weak var uiWebView: UIView?
    private var tabs: [String: Tab] = [:]

    init(uiWebView: UIView) {
        self.uiWebView = uiWebView
    }

    var count: Int { tabs.count }

    func open(id: String, url: String, profile: String, initScript: String) throws {
        if tabs[id] != nil { return }
        guard #available(iOS 17.0, *) else { throw TabsError.unsupportedSystem }
        guard let address = URL(string: url) else { throw TabsError.invalidUrl(url) }
        guard let store = UUID(uuidString: profile) else { throw TabsError.invalidProfile(profile) }
        guard let ui = uiWebView, let container = ui.superview else { throw TabsError.noSuperview }

        let tab = Tab(url: address, profile: store, initScript: initScript,
                      webView: makeWebView(profile: store, initScript: initScript))
        tabs[id] = tab
        container.insertSubview(tab.webView, aboveSubview: ui)
        tab.webView.load(URLRequest(url: address))
    }

    /// `css` is in CSS pixels of the UI webview; `nil` parks the tab.
    func place(id: String, css: CGRect?) {
        guard let tab = tabs[id] else { return }
        let origin = uiWebView?.frame.origin ?? .zero
        tab.frame = css.map {
            CssFrame.frame(x: $0.minX, y: $0.minY, width: $0.width, height: $0.height, origin: origin)
        } ?? CssFrame.parked
        tab.webView.frame = tab.frame
        if css != nil { tab.webView.superview?.bringSubviewToFront(tab.webView) }
    }

    /// Runs `script` now and again after every page load (a reload resets the page runtime).
    func applyPolicy(id: String, script: String) {
        guard let tab = tabs[id] else { return }
        tab.policyScript = script
        tab.webView.evaluateJavaScript(script)
    }

    func reload(id: String) {
        tabs[id]?.webView.reload()
    }

    func close(id: String) {
        guard let tab = tabs.removeValue(forKey: id) else { return }
        tab.webView.navigationDelegate = nil
        tab.webView.removeFromSuperview()
    }

    func closeAll() {
        tabs.keys.forEach(close)
    }

    /// For tests: the live webview of a tab.
    func webView(for id: String) -> WKWebView? {
        tabs[id]?.webView
    }

    @available(iOS 17.0, *)
    private func makeWebView(profile: UUID, initScript: String) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: profile)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        if !initScript.isEmpty {
            config.userContentController.addUserScript(
                WKUserScript(source: initScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let webView = WKWebView(frame: CssFrame.parked, configuration: config)
        webView.navigationDelegate = self
        return webView
    }

    private func tab(of webView: WKWebView) -> Tab? {
        tabs.values.first { $0.webView === webView }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let script = tab(of: webView)?.policyScript {
            webView.evaluateJavaScript(script)
        }
    }

    /// iOS kills the content process under memory pressure; reload brings the game back.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
