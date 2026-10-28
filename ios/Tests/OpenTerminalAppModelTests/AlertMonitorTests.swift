import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct AlertMonitorModelTests {
    private func fixture() async -> TerminalModel {
        MonitorProtocol.handler = { $0.fixture() }
        let model = TerminalModel(defaults: MonitorDefaults(suiteName: "monitor-memory-\(UUID())")!, credentials: MonitorCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MonitorProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession()
        return model
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        try #require(predicate(), "Expected monitor request did not arrive")
    }
    @Test func refreshReadsRulesAndMonitorInOneReadWithoutTriggeringACheck() async {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        MonitorProtocol.handler = { request in
            #expect(request.request.httpMethod == "GET" && request.request.url?.path == "/api/alerts")
            request.page(running: true, value: 110)
        }
        await model.refreshAlerts()
        #expect(model.alertMonitor?.state == .running && model.alertMonitor?.lastAttempt != nil && model.alertMonitor?.missingSymbols == ["MSFT"])
        #expect(model.alertMonitor?.lastError == "Fresh quotes unavailable for MSFT.")
        #expect(model.alerts.first?.last_value == 110 && model.alerts.first?.lastEvaluation != nil)
        #expect(model.sectionUpdated[.alerts] != nil && model.alertMonitorReceivedAt == model.sectionUpdated[.alerts] && model.sectionErrors.isEmpty && model.loadingSections.isEmpty)
        #expect(model.sectionUpdated.keys.allSatisfy { $0 == .alerts } && model.signedIn)
    }
    @Test func failedRefreshKeepsTheLastReceivedSnapshotAndRetryReplacesIt() async {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts(); let before = model.alertMonitor, rules = model.alerts, time = model.sectionUpdated[.alerts]
        MonitorProtocol.handler = { $0.respond(503, #"{"error":"Monitor unavailable"}"#) }; await model.refreshAlerts()
        #expect(model.alertMonitor == before && model.alerts == rules && model.sectionUpdated[.alerts] == time && model.alertMonitorReceivedAt == time && model.sectionErrors[.alerts] != nil)
        #expect(model.signedIn && !model.loadingSections.contains(.alerts))
        MonitorProtocol.handler = { $0.page(running: false, value: 120) }; await model.refreshAlerts()
        #expect(model.alertMonitor?.state == .stopped && model.alerts.first?.last_value == 120 && model.sectionErrors[.alerts] == nil)
    }
    @Test func legacyResponseClearsPreviousMonitorRatherThanPretendingItIsCurrent() async {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts(); #expect(model.alertMonitor != nil)
        MonitorProtocol.handler = { $0.respond(200, #"{"alerts":[]}"#) }; await model.refreshAlerts()
        #expect(model.alertMonitor == nil && model.alertMonitorReceivedAt == nil && model.alerts.isEmpty && model.sectionUpdated[.alerts] != nil && model.sectionErrors[.alerts] == nil)
    }
    @Test(arguments: [200, 401, 503], [false, true]) func newerRefreshWinsOverAnOlderSnapshotOrError(status: Int, newerFinishesFirst: Bool) async throws {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts(); let before = model.alertMonitor
        let old = MonitorGate(), latest = MonitorGate(); MonitorProtocol.handler = { old.hold($0) }
        let first = Task { await model.refreshAlerts() }; try await eventually { old.waiting }
        MonitorProtocol.handler = { latest.hold($0) }
        let second = Task { await model.refreshAlerts() }; try await eventually { latest.waiting }
        if newerFinishesFirst { latest.page(running: false, value: 120); await second.value }
        if status == 200 { old.page(running: true, value: 999) } else { old.release(status, "") }; await first.value
        #expect(model.signedIn && model.error == nil && model.sectionErrors[.alerts] == nil)
        if !newerFinishesFirst {
            #expect(model.loadingSections.contains(.alerts) && model.alertMonitor == before)
            latest.page(running: false, value: 120); await second.value
        }
        #expect(model.alertMonitor?.state == .stopped && model.alerts.first?.last_value == 120 && !model.loadingSections.contains(.alerts))
    }
    @Test(arguments: [200, 401]) func signOutClearsTheSnapshotAndLateRepliesCannotAffectANewConnection(status: Int) async throws {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts(); let old = MonitorGate(), logout = MonitorGate(), latest = MonitorGate()
        MonitorProtocol.handler = { request in
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.url?.path == "/api/alerts" { latest.hold(request) }
            else { request.fixture() }
        }
        let refresh = Task { await model.refreshAlerts() }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(model.alertMonitor == nil && model.alertMonitorReceivedAt == nil && model.alerts.isEmpty && model.sectionUpdated[.alerts] == nil)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        let next = Task { await model.refreshAlerts() }; try await eventually { latest.waiting }
        if status == 200 { old.page(running: true, value: 999) } else { old.release(status, "") }; await refresh.value
        #expect(model.alertMonitor == nil && model.loadingSections.contains(.alerts) && model.signedIn && model.error == nil)
        logout.release(200, #"{"ok":true}"#); await signOut.value
        latest.page(running: false, value: 120); await next.value
        #expect(model.alertMonitor?.state == .stopped && model.alerts.first?.last_value == 120 && model.server?.origin.host == "second.example.com")
    }
    @Test func cancellationPreservesTheLastSnapshotAndReleasesLoading() async throws {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts(); let before = model.alertMonitor, time = model.sectionUpdated[.alerts], gate = MonitorGate()
        MonitorProtocol.handler = { gate.hold($0) }
        let refresh = Task { await model.refreshAlerts() }; try await eventually { gate.waiting }
        refresh.cancel(); await refresh.value
        #expect(model.alertMonitor == before && model.sectionUpdated[.alerts] == time && model.sectionErrors[.alerts] == nil && !model.loadingSections.contains(.alerts))
    }
    @Test func currentUnauthorizedResponseClearsMonitorAndRules() async {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts()
        MonitorProtocol.handler = { request in
            if request.request.httpMethod == "DELETE" { request.fixture() } else { request.respond(401, "") }
        }
        await model.refreshAlerts()
        #expect(!model.signedIn && model.error != nil && model.alertMonitor == nil && model.alerts.isEmpty)
        #expect(model.sectionUpdated.isEmpty && model.sectionErrors.isEmpty && model.loadingSections.isEmpty)
    }
    @Test func malformedMonitorIsAReadFailureAndKeepsPreviousData() async {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts(); let before = model.alertMonitor, rules = model.alerts, time = model.sectionUpdated[.alerts]
        MonitorProtocol.handler = { $0.respond(200, #"{"alerts":[],"monitor":{"running":"yes"}}"#) }; await model.refreshAlerts()
        #expect(model.alertMonitor == before && model.alerts == rules && model.sectionUpdated[.alerts] == time && model.sectionErrors[.alerts] != nil)
    }
    @Test func anAcknowledgedActionKeepsTheMonitorReceiptTimeWhenItsFollowUpReadFails() async throws {
        let model = await fixture(); defer { MonitorProtocol.handler = nil }
        await model.refreshAlerts(); let rule = try #require(model.alerts.first), before = model.alertMonitor, received = model.alertMonitorReceivedAt
        MonitorProtocol.handler = { request in
            if request.request.httpMethod == "PUT" { request.respond(200, #"{"id":1}"#) }
            else { request.respond(503, #"{"error":"Retry later"}"#) }
        }
        await model.setArmed(rule, session: model.sessionID)
        try await eventually { model.sectionErrors[.alerts] != nil }
        #expect(model.alertMonitor == before && model.alertMonitorReceivedAt == received && received != nil)
        #expect(model.sectionUpdated[.alerts] == nil && model.alerts.first?.armed == 0 && model.alerts.first?.last_value == nil && model.alertActionErrors.isEmpty)
    }
}

@MainActor private final class MonitorCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-monitor-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class MonitorDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
}
private final class MonitorGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: MonitorProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: MonitorProtocol) { lock.withLock { held = value } }
    private func take() -> MonitorProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func page(running: Bool, value: Double) { take()?.page(running: running, value: value) }
}
private final class MonitorProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (MonitorProtocol) -> Void)?
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
    func page(running: Bool, value: Double) {
        respond(200, "{\"alerts\":[{\"id\":1,\"symbol\":\"AAPL\",\"condition\":\"PRICE_ABOVE\",\"threshold\":200,\"label\":\"Target\",\"armed\":1,\"revision\":1,\"generation\":\"g1\",\"last_checked_at\":\"2026-10-28T01:00:00Z\",\"last_value\":\(value),\"last_triggered_at\":null}],\"monitor\":{\"running\":\(running),\"checking\":false,\"intervalMs\":15000,\"lastCheckedAt\":\"2026-10-28T01:00:00Z\",\"lastError\":\"Fresh quotes unavailable for MSFT.\",\"missingSymbols\":[\"MSFT\"]}}")
    }
    func fixture() {
        if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#) }
        else if request.url?.path == "/api/mobile/session" { respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if request.url?.path == "/api/alerts" { page(running: true, value: 110) }
        else { respond(404, #"{"error":"Unexpected monitor fixture"}"#) }
    }
}
