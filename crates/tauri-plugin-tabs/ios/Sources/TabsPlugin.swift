import SwiftRs
import Tauri
import UIKit
import WebKit

// Argument classes mirror `crates/tauri-plugin-tabs/src/models.rs`.

class OpenArgs: Decodable {
    let id: String
    let url: String
    let profile: String
    let initScript: String
}

class BoundsArgs: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

class PlaceArgs: Decodable {
    let id: String
    let bounds: BoundsArgs?
}

class PolicyArgs: Decodable {
    let id: String
    let script: String
}

class TabArgs: Decodable {
    let id: String
}

class KeepAliveArgs: Decodable {
    let activeTabs: Int
    let title: String
    let text: String
}

class TabsPlugin: Plugin {
    private var games: GameWebViews?

    @objc public override func load(webview: WKWebView) {
        games = GameWebViews(uiWebView: webview)
    }

    @objc public func open(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenArgs.self)
        onMain(invoke) { try $0.open(id: args.id, url: args.url, profile: args.profile, initScript: args.initScript) }
    }

    @objc public func place(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PlaceArgs.self)
        let css = args.bounds.map { CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height) }
        onMain(invoke) { $0.place(id: args.id, css: css) }
    }

    @objc public func applyPolicy(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PolicyArgs.self)
        onMain(invoke) { $0.applyPolicy(id: args.id, script: args.script) }
    }

    @objc public func reload(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(TabArgs.self)
        onMain(invoke) { $0.reload(id: args.id) }
    }

    @objc public func close(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(TabArgs.self)
        onMain(invoke) { $0.close(id: args.id) }
    }

    /// iOS does not let apps run in the background, so the best we can do is keep
    /// the screen from auto-locking (which would background the app) while tabs run.
    @objc public func keepAlive(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(KeepAliveArgs.self)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = args.activeTabs > 0
            invoke.resolve()
        }
    }

    private func onMain(_ invoke: Invoke, _ action: @escaping (GameWebViews) throws -> Void) {
        DispatchQueue.main.async {
            guard let games = self.games else {
                invoke.reject("The UI webview is not ready yet")
                return
            }
            do {
                try action(games)
                invoke.resolve()
            } catch {
                invoke.reject(error.localizedDescription)
            }
        }
    }
}

@_cdecl("init_plugin_tabs")
func initPlugin() -> Plugin {
    return TabsPlugin()
}
