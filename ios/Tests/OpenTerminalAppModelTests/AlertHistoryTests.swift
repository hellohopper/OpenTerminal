import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct AlertHistoryModelTests {
    private func fixture() async -> (TerminalModel, AlertHistoryModel) {
        HistoryProtocol.handler = { $0.fixture() }
        let terminal = TerminalModel(defaults: HistoryDefaults(suiteName: "history-memory-\(UUID())")!, credentials: HistoryCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [HistoryProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        terminal.serverText = "https://first.example.com"; await terminal.restoreSession()
        return (terminal, AlertHistoryModel(terminal: terminal))
    }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(5)) }
        try #require(condition(), "Expected history request did not arrive")
    }
    @Test func latestPageAndEmptyResultHaveIndependentLoadingState() async throws {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        let gate = HistoryGate(); HistoryProtocol.handler = { gate.hold($0) }
        let load = Task { await history.loadLatest() }; try await eventually { gate.waiting }
        #expect(history.loadingLatest && !history.hasLoaded && !history.loadingMore)
        gate.page([60, 59], next: 59); await load.value
        #expect(history.events.map(\.id) == [60, 59] && history.nextCursor == 59)
        #expect(history.updated != nil && history.hasLoaded && !history.loadingLatest && history.error == nil)
        #expect(terminal.sectionUpdated.isEmpty && terminal.signedIn && !terminal.reconnecting)
        HistoryProtocol.handler = { $0.page([], next: nil) }; await history.loadLatest()
        #expect(history.events.isEmpty && history.nextCursor == nil && history.hasLoaded)
    }
    @Test func paginationUsesTheCursorDeduplicatesAndBlocksDuplicateTaps() async throws {
        let (_, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        await history.loadLatest()
        let gate = HistoryGate(); HistoryProtocol.handler = { request in
            #expect(request.request.url?.path == "/api/alerts/history" && request.request.httpMethod == "GET")
            #expect(URLComponents(url: request.request.url!, resolvingAgainstBaseURL: false)?.queryItems == [URLQueryItem(name: "before", value: "59")])
            gate.hold(request)
        }
        let load = Task { await history.loadMore() }; try await eventually { gate.waiting }
        #expect(history.loadingMore && !history.loadingLatest)
        await history.loadMore(); #expect(gate.count == 1)
        gate.page([59, 58, 58, 57], next: nil); await load.value
        #expect(history.events.map(\.id) == [60, 59, 58, 57] && history.nextCursor == nil && !history.loadingMore)
        await history.loadMore(); #expect(gate.count == 1)
    }
    @Test func failedOlderPageKeepsItsCursorAndRowsForExplicitRetry() async {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        await history.loadLatest(); let before = history.events, updated = history.updated
        HistoryProtocol.handler = { $0.respond(503, #"{"error":"History unavailable"}"#) }; await history.loadMore()
        #expect(history.pageError != nil && history.error == nil && history.nextCursor == 59 && history.events == before && history.updated == updated)
        #expect(!history.loadingMore && terminal.error == nil && !terminal.reconnecting)
        HistoryProtocol.handler = { $0.page([58], next: nil) }; await history.loadMore()
        #expect(history.events.map(\.id) == [60, 59, 58] && history.pageError == nil && history.nextCursor == nil)
    }
    @Test func failedLatestReadPreservesPreviouslyLoadedRowsAndCanRetry() async {
        let (_, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        await history.loadLatest(); let before = history.events, updated = history.updated
        HistoryProtocol.handler = { $0.respond(503, "") }; await history.loadLatest()
        #expect(history.error != nil && history.events == before && history.nextCursor == 59 && history.updated == updated && !history.loadingLatest)
        HistoryProtocol.handler = { $0.page([100], next: nil) }; await history.loadLatest()
        #expect(history.events.map(\.id) == [100] && history.error == nil && !history.loadingLatest)
    }
    @Test func failedFirstReadCanRetryWithoutClaimingTheHistoryIsEmpty() async {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        HistoryProtocol.handler = { $0.respond(503, "") }; await history.loadLatest()
        #expect(history.error != nil && !history.hasLoaded && history.updated == nil && !history.loadingLatest && terminal.signedIn)
        HistoryProtocol.handler = { $0.page([], next: nil) }; await history.loadLatest()
        #expect(history.error == nil && history.hasLoaded && history.events.isEmpty && history.updated != nil)
    }
    @Test(arguments: [200, 401, 503]) func refreshingSupersedesAnOlderPageWithoutEndingTheNewRequest(status: Int) async throws {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        await history.loadLatest(); let old = HistoryGate(), latest = HistoryGate()
        HistoryProtocol.handler = { old.hold($0) }
        let page = Task { await history.loadMore() }; try await eventually { old.waiting }
        HistoryProtocol.handler = { latest.hold($0) }
        let refresh = Task { await history.loadLatest() }; try await eventually { latest.waiting }
        await history.loadMore(); #expect(old.count == 1 && latest.count == 1)
        if status == 200 { old.page([58], next: 58) } else { old.release(status, "") }; await page.value
        #expect(history.loadingLatest && !history.loadingMore && history.events.map(\.id) == [60, 59])
        #expect(terminal.signedIn && terminal.error == nil && history.error == nil && history.pageError == nil)
        latest.page([100, 99], next: 99); await refresh.value
        #expect(history.events.map(\.id) == [100, 99] && history.nextCursor == 99 && !history.loadingLatest)
    }
    @Test(arguments: [200, 401, 503]) func newerLatestReadWinsOverAnOlderRead(status: Int) async throws {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        let old = HistoryGate(); HistoryProtocol.handler = { old.hold($0) }
        let load = Task { await history.loadLatest() }; try await eventually { old.waiting }
        HistoryProtocol.handler = { $0.page([100], next: nil) }; await history.loadLatest()
        if status == 200 { old.page([60, 59], next: 59) } else { old.release(status, "") }; await load.value
        #expect(history.events.map(\.id) == [100] && history.nextCursor == nil && !history.loadingLatest && history.error == nil && terminal.signedIn)
    }
    @Test(arguments: [200, 401]) func signOutClearsHistoryAndLateResponsesCannotAffectANewServer(status: Int) async throws {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        await history.loadLatest(); let old = HistoryGate(), logout = HistoryGate(), latest = HistoryGate()
        HistoryProtocol.handler = { request in
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.url?.path == "/api/alerts/history" { latest.hold(request) }
            else { request.fixture() }
        }
        let page = Task { await history.loadMore() }; try await eventually { old.waiting }
        let signOut = Task { await terminal.signOut() }; try await eventually { logout.waiting }
        #expect(history.events.isEmpty && history.nextCursor == nil && history.updated == nil && !history.hasLoaded && !history.loadingMore)
        terminal.serverText = "https://second.example.com"; await terminal.restoreSession(force: true)
        let newHistory = AlertHistoryModel(terminal: terminal), load = Task { await newHistory.loadLatest() }
        try await eventually { latest.waiting }
        await history.loadLatest(); await history.loadMore(); #expect(old.count == 1 && latest.count == 1)
        if status == 200 { old.page([58], next: 58) } else { old.release(status, "") }; await page.value
        #expect(history.events.isEmpty && newHistory.loadingLatest && terminal.signedIn && terminal.error == nil)
        logout.release(200, #"{"ok":true}"#); await signOut.value
        latest.page([200], next: nil); await load.value
        #expect(newHistory.events.map(\.id) == [200] && history.events.isEmpty && terminal.server?.origin.host == "second.example.com")
    }
    @Test(arguments: [false, true]) func currentUnauthorizedReadClearsAllHistoryAndSignsOut(olderPage: Bool) async {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        await history.loadLatest()
        HistoryProtocol.handler = { request in
            if request.request.httpMethod == "DELETE" { request.fixture() } else { request.respond(401, "") }
        }
        if olderPage { await history.loadMore() } else { await history.loadLatest() }
        #expect(!terminal.signedIn && terminal.error != nil && history.events.isEmpty && history.nextCursor == nil)
        #expect(!history.hasLoaded && history.updated == nil && history.error == nil && history.pageError == nil && !history.loadingLatest && !history.loadingMore)
    }
    @Test(arguments: [false, true]) func cancelledReadsKeepVisibleDataAndReleaseProgress(olderPage: Bool) async throws {
        let (terminal, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        if olderPage { await history.loadLatest() }
        let before = history.events, gate = HistoryGate(); HistoryProtocol.handler = { gate.hold($0) }
        let load = Task { if olderPage { await history.loadMore() } else { await history.loadLatest() } }
        try await eventually { gate.waiting }; load.cancel(); await load.value
        #expect(history.events == before && history.nextCursor == (olderPage ? 59 : nil))
        #expect(!history.loadingLatest && !history.loadingMore && history.error == nil && history.pageError == nil && terminal.signedIn)
    }
    @Test(arguments: [0, -1, 59, 60]) func nonadvancingOlderCursorCannotLoop(cursor: Int) async {
        let (_, history) = await fixture(); defer { HistoryProtocol.handler = nil }
        await history.loadLatest()
        HistoryProtocol.handler = { $0.page([58], next: cursor) }; await history.loadMore()
        #expect(history.nextCursor == nil && history.events.map(\.id) == [60, 59, 58])
    }
    @Test func unitsAndTinyThresholdsStayReadable() {
        let locale = Locale(identifier: "en_US")
        #expect(alertValueText(3.5, kind: .dailyChange, currency: "USD", locale: locale) == "3.5%")
        #expect(alertValueText(-2, kind: .dailyChange, locale: locale) == "-2%")
        #expect(alertValueText(110, kind: .price, currency: "USD", locale: locale) == "110 USD")
        #expect(alertValueText(100000, kind: .volume, currency: "USD", locale: locale) == "100,000")
        #expect(alertValueText(2, kind: .unknown, currency: "USD", locale: locale) == "2")
        #expect(alertValueText(0.00000001, kind: .price, locale: locale) == "0.00000001")
        #expect(alertValueText(3.5, kind: .dailyChange, locale: Locale(identifier: "de_DE")) == "3,5%")
    }
}

@MainActor private final class HistoryCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-history-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class HistoryDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
}
private final class HistoryGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: HistoryProtocol?; private var total = 0
    var waiting: Bool { lock.withLock { held != nil } }
    var count: Int { lock.withLock { total } }
    func hold(_ value: HistoryProtocol) { lock.withLock { held = value; total += 1 } }
    private func take() -> HistoryProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func page(_ ids: [Int], next: Int?) { take()?.page(ids, next: next) }
}
private final class HistoryProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (HistoryProtocol) -> Void)?
    private let lock = NSLock(); private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(self) }
    override func stopLoading() { lock.withLock { stopped = true } }
    func respond(_ status: Int, _ body: String) {
        guard !lock.withLock({ stopped }) else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    func page(_ ids: [Int], next: Int?) {
        let rows: [[String: Any]] = ids.map { ["id": $0, "alert_id": 1, "symbol": "AAPL", "condition": "PRICE_ABOVE", "threshold": 100, "label": "Saved trigger", "value": 110, "price": 110, "currency": "USD", "source": "fixture", "observed_at": NSNull(), "created_at": "2026-10-24T13:00:00Z", "metric": "native"] }
        let data = try! JSONSerialization.data(withJSONObject: ["events": rows, "nextCursor": next.map { $0 as Any } ?? NSNull()])
        respond(200, String(decoding: data, as: UTF8.self))
    }
    func fixture() {
        if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#) }
        else if request.url?.path == "/api/mobile/session" { respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if request.url?.path == "/api/alerts/history" { page([60, 59], next: 59) }
        else { respond(404, #"{"error":"Unexpected history fixture"}"#) }
    }
}
