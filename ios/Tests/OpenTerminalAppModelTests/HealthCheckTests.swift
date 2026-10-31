import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct HealthCheckTests {
    private let names: Set<String> = ["Connection", "Backups", "Native push"]
    private func fixture() async -> TerminalModel {
        HealthProtocol.handler = { $0.fixture() }
        let model = TerminalModel(defaults: HealthDefaults(suiteName: "health-memory-\(UUID())")!, credentials: HealthCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [HealthProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession()
        return model
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        try #require(predicate(), "Expected health check state did not arrive")
    }
    @Test func allThreeChecksAreReadOnlyAndCarryTheDeviceSession() async {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        let requests = HealthRequests()
        HealthProtocol.handler = { request in requests.append(request); request.fixture() }
        await model.checkHealth(session: model.sessionID)
        #expect(Set(requests.paths) == Set(["/api/status", "/api/data/schedule", "/api/mobile/push"]) && requests.paths.count == 3)
        #expect(requests.readOnlyAuthenticated)
        #expect(Set(model.health.keys) == names && Set(model.healthReceivedAt.keys) == names && model.healthErrors.isEmpty && !model.checkingHealth)
        #expect(model.sectionErrors.isEmpty && model.sectionUpdated.isEmpty && model.error == nil && !model.reconnecting)
    }
    @Test func partialFailurePreservesThePreviousSnapshotAndReceiptUntilRetry() async throws {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        await model.checkHealth(session: model.sessionID)
        let before = model.health, received = model.healthReceivedAt
        HealthProtocol.handler = { request in
            if request.request.url?.path == "/api/status" { request.respond(503, #"{"error":"Mac status unavailable"}"#) }
            else { request.fixture(database: "new database") }
        }
        await model.checkHealth(session: model.sessionID)
        #expect(model.health["Connection"] == before["Connection"] && model.healthReceivedAt["Connection"] == received["Connection"])
        #expect(model.healthErrors.keys.sorted() == ["Connection"] && model.healthErrors["Connection"]?.contains("unavailable") == true)
        #expect(model.healthReceivedAt["Backups"] != nil && model.healthReceivedAt["Native push"] != nil && !model.reconnecting && model.error == nil)
        HealthProtocol.handler = { $0.fixture(database: "recovered database") }
        await model.checkHealth(session: model.sessionID)
        #expect(model.health["Connection"]?.contains("recovered database") == true && model.healthErrors.isEmpty)
        let after = try #require(model.healthReceivedAt["Connection"]), previous = try #require(received["Connection"])
        #expect(after >= previous)
    }
    @Test func slowCheckDoesNotBlockOtherResultsOrAllowDuplicateChecks() async throws {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        let gate = HealthGate(), requests = HealthRequests()
        HealthProtocol.handler = { request in
            requests.append(request)
            if request.request.url?.path == "/api/mobile/push" { gate.hold(request) } else { request.fixture() }
        }
        let session = model.sessionID, task = Task { await model.checkHealth(session: session) }
        try await eventually { gate.waiting && model.health.count == 2 }
        await model.checkHealth(session: session)
        #expect(model.checkingHealth && model.healthReceivedAt.count == 2 && requests.paths.count == 3)
        gate.release(); await task.value
        #expect(model.health.count == 3 && !model.checkingHealth)
    }
    @Test(arguments: [false, true]) func cancellationKeepsSnapshotsAndCannotAffectARetry(newerFinishesFirst: Bool) async throws {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        await model.checkHealth(session: model.sessionID)
        let before = model.health, received = model.healthReceivedAt, old = HealthGate(), latest = HealthGate()
        HealthProtocol.handler = { request in
            if request.request.url?.path == "/api/status" { old.hold(request) } else { request.fixture() }
        }
        let session = model.sessionID, first = Task { await model.checkHealth(session: session) }
        try await eventually { old.waiting }
        first.cancel(); try await eventually { !model.checkingHealth }
        #expect(model.health["Connection"] == before["Connection"] && model.healthReceivedAt["Connection"] == received["Connection"] && model.healthErrors.isEmpty)
        HealthProtocol.handler = { request in
            if request.request.url?.path == "/api/status" { latest.hold(request) } else { request.fixture() }
        }
        let second = Task { await model.checkHealth(session: session) }; try await eventually { latest.waiting }
        if newerFinishesFirst { latest.release(database: "latest"); await second.value }
        old.release(database: "obsolete"); await first.value
        #expect(model.signedIn && model.error == nil && model.healthErrors.isEmpty)
        if !newerFinishesFirst {
            #expect(model.checkingHealth && model.health["Connection"] == before["Connection"])
            latest.release(database: "latest"); await second.value
        }
        #expect(!model.checkingHealth && model.health["Connection"]?.contains("latest") == true)
    }
    @Test(arguments: [200, 401, 503]) func oldSessionCannotChangeNewHealthOrItsProgress(status: Int) async throws {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        await model.checkHealth(session: model.sessionID)
        let oldSession = model.sessionID, old = HealthGate(), logout = HealthGate(), latest = HealthGate()
        HealthProtocol.handler = { request in
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) }
                else if request.request.url?.path == "/api/status" { old.hold(request) }
                else { request.fixture() }
            } else if request.request.url?.path == "/api/status" { latest.hold(request) }
            else { request.fixture() }
        }
        let first = Task { await model.checkHealth(session: oldSession) }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(model.health.isEmpty && model.healthErrors.isEmpty && model.healthReceivedAt.isEmpty && !model.checkingHealth)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        let nextSession = model.sessionID, second = Task { await model.checkHealth(session: nextSession) }
        try await eventually { latest.waiting }
        let requests = HealthRequests()
        HealthProtocol.handler = { request in requests.append(request); request.fixture() }
        await model.checkHealth(session: oldSession); #expect(requests.paths.isEmpty)
        old.release(status: status, database: "obsolete"); await first.value
        #expect(model.signedIn && model.error == nil && model.checkingHealth && model.health["Connection"] == nil && model.healthErrors.isEmpty)
        logout.release(); await signOut.value
        #expect(model.checkingHealth && model.server?.origin.host == "second.example.com")
        latest.release(database: "second server"); await second.value
        #expect(!model.checkingHealth && model.health["Connection"]?.contains("second server") == true && model.signedIn)
    }
    @Test(arguments: ["/api/status", "/api/data/schedule", "/api/mobile/push"]) func unauthorizedCheckClearsAllHealthAndRequiresSignIn(path: String) async {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        await model.checkHealth(session: model.sessionID)
        HealthProtocol.handler = { request in
            if request.request.url?.path == path { request.respond(401, "") } else { request.fixture() }
        }
        await model.checkHealth(session: model.sessionID)
        #expect(!model.signedIn && model.error != nil && model.health.isEmpty && model.healthReceivedAt.isEmpty && model.healthErrors.isEmpty && !model.checkingHealth)
    }
    @Test(arguments: [#"{"ok":false,"database":"sqlite"}"#, #"{"ok":"yes","database":"sqlite"}"#]) func unreadyOrMalformedStatusKeepsTheLastGoodSnapshot(body: String) async {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        await model.checkHealth(session: model.sessionID); let before = model.health, received = model.healthReceivedAt
        HealthProtocol.handler = { request in
            if request.request.url?.path == "/api/status" { request.respond(200, body) } else { request.fixture() }
        }
        await model.checkHealth(session: model.sessionID)
        #expect(model.health["Connection"] == before["Connection"] && model.healthReceivedAt["Connection"] == received["Connection"] && model.healthErrors["Connection"] != nil)
        #expect(model.signedIn && !model.checkingHealth && !model.reconnecting && model.error == nil)
    }
    @Test func canceledBeforeDispatchOrSignedOutCheckSendsNoRequests() async {
        let model = await fixture(); defer { HealthProtocol.handler = nil }
        let session = model.sessionID, requests = HealthRequests()
        HealthProtocol.handler = { request in requests.append(request); request.fixture() }
        let canceled = Task { await model.checkHealth(session: session) }; canceled.cancel(); await canceled.value
        #expect(requests.paths.isEmpty && model.health.isEmpty && !model.checkingHealth)
        await model.signOut(); requests.clear(); await model.checkHealth(session: model.sessionID)
        #expect(requests.paths.isEmpty && model.healthReceivedAt.isEmpty && model.healthErrors.isEmpty)
    }
}

@MainActor private final class HealthCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "health-test-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class HealthDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
}
private final class HealthRequests: @unchecked Sendable {
    private let lock = NSLock(); private var requests: [URLRequest] = []
    func append(_ value: HealthProtocol) { lock.withLock { requests.append(value.request) } }
    func clear() { lock.withLock { requests = [] } }
    var paths: [String] { lock.withLock { requests.compactMap { $0.url?.path } } }
    var readOnlyAuthenticated: Bool { lock.withLock { requests.allSatisfy { $0.httpMethod == "GET" && $0.value(forHTTPHeaderField: "Authorization") == "Bearer health-test-token" } } }
}
private final class HealthGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: HealthProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: HealthProtocol) { lock.withLock { held = value } }
    func release(status: Int = 200, database: String = "sqlite") {
        let value = lock.withLock { let value = held; held = nil; return value }
        if status == 200 { value?.fixture(database: database) } else { value?.respond(status, #"{"error":"Late health failure"}"#) }
    }
}
private final class HealthProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (HealthProtocol) -> Void)?
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
    func fixture(database: String = "sqlite") {
        if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#); return }
        switch request.url?.path {
        case "/api/mobile/session": respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#)
        case "/api/status": respond(200, "{\"ok\":true,\"database\":\"\(database)\"}")
        case "/api/data/schedule": respond(200, #"{"policy":{"enabled":false},"status":{"lastSuccess":null,"error":null}}"#)
        case "/api/mobile/push": respond(200, #"{"configured":false}"#)
        default: respond(404, #"{"error":"Unexpected health fixture"}"#)
        }
    }
}
