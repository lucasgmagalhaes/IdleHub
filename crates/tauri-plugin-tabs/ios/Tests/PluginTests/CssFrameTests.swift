import CoreGraphics
import XCTest
@testable import tauri_plugin_tabs

final class CssFrameTests: XCTestCase {
    func testCssPixelsArePointsOffsetByTheUiWebView() {
        let frame = CssFrame.frame(x: 10, y: 60, width: 390, height: 700, origin: CGPoint(x: 0, y: 47))
        XCTAssertEqual(frame, CGRect(x: 10, y: 107, width: 390, height: 700))
    }

    func testNeverCollapsesToZeroSize() {
        let frame = CssFrame.frame(x: 0, y: 0, width: 0, height: -3, origin: .zero)
        XCTAssertEqual(frame.size, CGSize(width: 1, height: 1))
    }

    func testParkedTabsStayOnePointInTheCorner() {
        XCTAssertEqual(CssFrame.parked, CGRect(x: 0, y: 0, width: 1, height: 1))
    }
}
