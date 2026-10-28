import UIKit
import WebKit
import XCTest
@testable import tauri_plugin_tabs

/// Runs on the iOS simulator. Checks the promise IdleHub makes on iOS: while the
/// app is open, a tab that is not on screen keeps running its game.
@MainActor
final class GameWebViewsTests: XCTestCase {
    private let game = "data:text/html,%3Cscript%3Ewindow.ticks%3D0%3BsetInterval(()%3D%3Ewindow.ticks%2B%2B%2C100)%3C%2Fscript%3E"
    private var window: UIWindow!
    private var games: GameWebViews!

    override func setUp() async throws {
        window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let host = UIViewController()
        window.rootViewController = host
        let ui = WKWebView(frame: host.view.bounds)
        host.view.addSubview(ui)
        window.makeKeyAndVisible()
        games = GameWebViews(uiWebView: ui)
    }

    override func tearDown() async throws {
        games.closeAll()
        window = nil
    }

    func testParkedTabKeepsTheSameTimerRateAsTheVisibleOne() async throws {
        try games.open(id: "visible", url: game, profile: UUID().uuidString, initScript: "")
        try games.open(id: "parked", url: game, profile: UUID().uuidString, initScript: "")
        games.place(id: "visible", css: CGRect(x: 0, y: 0, width: 390, height: 700))
        games.place(id: "parked", css: nil)

        try await sleep(1)
        let visibleStart = try await ticks("visible")
        let parkedStart = try await ticks("parked")
        try await sleep(5)
        let visible = try await ticks("visible") - visibleStart
        let parked = try await ticks("parked") - parkedStart

        XCTAssertGreaterThanOrEqual(visible, 40, "visible tab ran \(visible) ticks in 5 s")
        XCTAssertGreaterThanOrEqual(Double(parked), Double(visible) * 0.8, "parked tab ran \(parked) ticks (visible: \(visible))")
    }

    func testAccountsDoNotShareStorage() async throws {
        let page = "https://example.com/"
        try games.open(id: "a", url: page, profile: UUID().uuidString, initScript: "")
        try games.open(id: "b", url: page, profile: UUID().uuidString, initScript: "")
        try await waitForLoad("a")
        try await waitForLoad("b")

        _ = try await eval("a", "localStorage.setItem('who','a'); 'ok'")
        let seenByB = try await eval("b", "localStorage.getItem('who')")
        let seenByA = try await eval("a", "localStorage.getItem('who')")

        XCTAssertNil(seenByB as? String)
        XCTAssertEqual(seenByA as? String, "a")
    }

    func testPlacingMovesTheTabOverItsPane() throws {
        try games.open(id: "tab", url: game, profile: UUID().uuidString, initScript: "")
        games.place(id: "tab", css: CGRect(x: 10, y: 20, width: 100, height: 50))
        XCTAssertEqual(games.webView(for: "tab")?.frame, CGRect(x: 10, y: 20, width: 100, height: 50))
        games.place(id: "tab", css: nil)
        XCTAssertEqual(games.webView(for: "tab")?.frame, CssFrame.parked)
    }

    func testForgettingATabDeletesItsDataStore() async throws {
        // Closing a tab promises the user that its login and data are erased.
        let profile = UUID()
        try games.open(id: "gone", url: "https://example.com/", profile: profile.uuidString, initScript: "")
        try await waitForLoad("gone")
        let before = await dataStores()
        XCTAssertTrue(before.contains(profile))

        games.forget(id: "gone")
        XCTAssertNil(games.webView(for: "gone"))

        // Removal waits for WebKit to release the store, which is slow on CI simulators.
        var removed = false
        for _ in 0..<60 where !removed {
            try await sleep(0.5)
            removed = await !dataStores().contains(profile)
        }
        XCTAssertTrue(removed, "the data store was still there after 30 s")
    }

    func testClosingEverythingKeepsTheDataStores() async throws {
        // The app going away must not log every account out.
        let profile = UUID()
        try games.open(id: "kept", url: "https://example.com/", profile: profile.uuidString, initScript: "")
        try await waitForLoad("kept")
        games.closeAll()
        try await sleep(1)
        let stores = await dataStores()
        XCTAssertTrue(stores.contains(profile))
    }

    func testRejectsProfilesThatAreNotUuids() {
        XCTAssertThrowsError(try games.open(id: "x", url: game, profile: "nope", initScript: ""))
    }

    private func dataStores() async -> [UUID] {
        await withCheckedContinuation { done in
            WKWebsiteDataStore.fetchAllDataStoreIdentifiers { done.resume(returning: $0) }
        }
    }

    /// Waits until the tab shows its page: a fixed sleep fails when the simulator
    /// is slow to start WebKit (90 s seen on CI for the first page), and storage throws before then.
    private func waitForLoad(_ id: String, timeout: Double = 180) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let href = try? await eval(id, "document.readyState === 'complete' ? location.href : ''") as? String
            if let href, href.hasPrefix("https://") { return }
            try await sleep(0.5)
        }
        XCTFail("tab \(id) did not load in \(timeout) s")
    }

    private func sleep(_ seconds: Double) async throws {
        try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    private func eval(_ id: String, _ script: String) async throws -> Any? {
        try await games.webView(for: id)!.evaluateJavaScript(script)
    }

    private func ticks(_ id: String) async throws -> Int {
        (try await eval(id, "window.ticks") as? NSNumber)?.intValue ?? 0
    }
}
