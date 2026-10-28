import Foundation
import Network

/// A tiny HTTP server on 127.0.0.1 that answers every request with one HTML
/// page. Tests that need a real origin (storage, cookies) use it instead of a
/// site on the internet, whose first request timed out on CI simulators.
final class LocalServer {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "idlehub.tests.local-server")

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [queue] connection in
            connection.start(queue: queue)
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { _, _, _, _ in
                let body = "<!doctype html><title>game</title><p>game</p>"
                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n"
                    + "Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
                    connection.cancel()
                })
            }
        }
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.signal() }
        }
        listener.start(queue: queue)
        guard ready.wait(timeout: .now() + 10) == .success, listener.port != nil else {
            listener.cancel()
            throw URLError(.cannotConnectToHost)
        }
    }

    var url: String { "http://127.0.0.1:\(listener.port!.rawValue)/" }

    func stop() {
        listener.cancel()
    }
}
