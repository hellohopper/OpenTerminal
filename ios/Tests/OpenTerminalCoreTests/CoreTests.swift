import Foundation
import Testing
@testable import OpenTerminalCore

@Suite(.serialized) struct CoreTests {
    @Test func testServerOriginsAndQueryEncoding() throws {
        let server = try ServerConnection("https://terminal.example.com/")
        expectEqual(server.origin.absoluteString, "https://terminal.example.com")
        let url = try server.url(path: "/api/quotes", query: ["symbols": "^GSPC,EURUSD=X"])
        expectEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "^GSPC,EURUSD=X")
        for value in ["http://example.com", "https://user:secret@example.com", "https://example.com/api", "https://example.com?password=x", "file:///tmp", "https://example.com#x"] {
            expectThrows(try ServerConnection(value))
        }
        expectNoThrow(try ServerConnection("http://127.0.0.1:3100"))
        expectThrows(try server.url(path: "//evil.example/api"))
        expectThrows(try server.url(path: "/api/../session"))
        expectEqual(normalizedSymbol(" eurusd=x "), "EURUSD=X")
        expectNil(normalizedSymbol("<script>"))
    }
    @Test func testIncompleteAndExpiredValuationsWithholdTotals() throws {
        let positions = try JSONDecoder().decode([Position].self, from: Data(#"[{"symbol":"AAPL","quantity":2,"avgCost":90,"realizedPnl":0}]"#.utf8))
        let now = Date(timeIntervalSince1970: 1000)
        let quote = try JSONDecoder().decode(Quote.self, from: Data(#"{"symbol":"AAPL","price":100,"currency":"USD","source":"fixture","retrievedAt":"1970-01-01T00:16:40Z","stale":false}"#.utf8))
        expectNil(HoldingValuation(positions: positions, quotes: [], now: now).marketValue)
        expectEqual(HoldingValuation(positions: positions, quotes: [quote], now: now).marketValue, 200)
        expectEqual(HoldingValuation(positions: positions, quotes: [quote], now: now).unrealized, 20)
        expectNil(HoldingValuation(positions: positions, quotes: [quote], now: now.addingTimeInterval(121)).marketValue)
        for replacement in [#""stale":true"#, #""currency":"EUR"#] {
            let json = #"{"symbol":"AAPL","price":100,"currency":"USD","source":"fixture","retrievedAt":"1970-01-01T00:16:40Z","stale":false}"#
            let changed = json.replacingOccurrences(of: replacement.contains("stale") ? #""stale":false"# : #""currency":"USD"#, with: replacement)
            let q = try JSONDecoder().decode(Quote.self, from: Data(changed.utf8))
            expectNil(HoldingValuation(positions: positions, quotes: [q], now: now).marketValue)
        }
    }
    @Test func testNativeRequestsUseWebSessionOriginAndHandleExpiry() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureProtocol.self]
        FixtureProtocol.handler = { request in
            expectEqual(request.value(forHTTPHeaderField: "Origin"), "https://terminal.example.com")
            expectNil(request.value(forHTTPHeaderField: "x-api-key"))
            if request.url?.path == "/api/session" {
                expectEqual(request.httpMethod, "POST")
                expectEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
                return (200, Data(#"{"ok":true}"#.utf8))
            }
            return (401, Data(#"{"error":"Sign in required."}"#.utf8))
        }
        defer { FixtureProtocol.handler = nil }
        let api = TerminalAPI(server: try ServerConnection("https://terminal.example.com"), configuration: configuration)
        try await api.signIn(password: "fixture owner password")
        do { let _: [Portfolio] = try await api.get("/api/portfolios"); fail("Expected expired session") }
        catch { expectEqual(error as? ConnectionError, .unauthorized) }
    }
    @Test func testNativeWritesAndProviderErrors() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [FixtureProtocol.self]
        FixtureProtocol.handler = { request in
            if request.url?.path == "/api/alerts" { expectEqual(request.httpMethod, "POST"); return (201, Data(#"{"id":1}"#.utf8)) }
            if request.url?.path == "/api/alerts/1" { expectEqual(request.httpMethod, "PUT"); return (200, Data(#"{"id":1}"#.utf8)) }
            return (502, Data(#"{"error":"Provider unavailable"}"#.utf8))
        }
        defer { FixtureProtocol.handler = nil }
        let api = TerminalAPI(server: try ServerConnection("https://terminal.example.com"), configuration: configuration)
        let _: Acknowledgement = try await api.post("/api/alerts", body: AlertInput(symbol: "AAPL", condition: "PRICE_ABOVE", threshold: 200, label: "Test"))
        try await api.setAlertArmed(id: 1, armed: false)
        do { let _: [Quote] = try await api.get("/api/quotes"); fail("Expected provider error") }
        catch { expectEqual(error as? ConnectionError, .response(502, "Provider unavailable")) }
    }
    @Test func testInvalidPasswordIsDistinctFromAnExpiredSession() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [FixtureProtocol.self]
        FixtureProtocol.handler = { _ in (401, Data(#"{"error":"Invalid password."}"#.utf8)) }
        defer { FixtureProtocol.handler = nil }
        let api = TerminalAPI(server: try ServerConnection("https://terminal.example.com"), configuration: configuration)
        do { try await api.signIn(password: "incorrect"); fail("Expected invalid password") }
        catch { expectEqual(error as? ConnectionError, .response(401, "Invalid password.")) }
    }
}
// Small throwing-assertion adapters keep protocol callback assertions in the same test.
private func expectEqual<T: Equatable>(_ actual: T, _ expected: T) { #expect(actual == expected) }
private func expectNil<T>(_ value: T?) { if case .some = value { Issue.record("Expected nil") } }
private func expectThrows<T>(_ expression: @autoclosure () throws -> T) { do { _ = try expression(); Issue.record("Expected an error") } catch {} }
private func expectNoThrow<T>(_ expression: @autoclosure () throws -> T) { do { _ = try expression() } catch { Issue.record("Unexpected error: \(error)") } }
private func fail(_ message: String) { Issue.record(Comment(rawValue: message)) }
private final class FixtureProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
