import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct StartupTests {
    private func fixture() throws -> (TerminalModel, MemoryCredentials) {
        let vault = MemoryCredentials()
        vault.data = try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "device-token", expiresAt: "2030-01-01T00:00:00Z"))
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ModelProtocol.self]
        // The suite is read-only in these restore tests; no real Keychain or preferences are written.
        let defaults = UserDefaults(suiteName: "openterminal-test-\(UUID())")!
        let model = TerminalModel(defaults: defaults, credentials: vault) { TerminalAPI(server: $0, credential: $1, configuration: configuration) }
        model.serverText = "https://fixture.example.com"
        return (model, vault)
    }
    @Test func restoringAuthorizationDoesNotWaitForMarketRequests() async throws {
        ModelProtocol.handler = { request in
            #expect(request.request.url?.path == "/api/mobile/session")
            request.respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#)
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture()
        await model.restoreSession()
        #expect(model.signedIn); #expect(!model.restoring)
        #expect(model.sectionUpdated.isEmpty); #expect(model.lastUpdated == nil)
    }
    @Test func stalledWatchlistDoesNotBlockAccountsOrAlertsAndRetryClearsItsError() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/watchlists" { gate.hold(request) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession()
        let refresh = Task { await model.refresh() }
        await eventually { gate.isHeld && model.sectionUpdated[.alerts] != nil && model.sectionUpdated[.holdings] != nil }
        #expect(model.loadingSections.contains(.watchlist)); #expect(model.alerts.count == 1)
        gate.release(503, #"{"error":"Lists temporarily unavailable"}"#)
        await refresh.value
        #expect(model.sectionErrors[.watchlist] != nil); #expect(model.sectionErrors[.alerts] == nil)
        #expect(model.loadingSections.isEmpty); #expect(model.lastUpdated == nil)
        ModelProtocol.handler = { $0.respondFixture() }
        await model.refresh()
        #expect(model.sectionErrors.isEmpty); #expect(model.lastUpdated != nil); #expect(!model.reconnecting)
    }
    @Test func quoteFailureDoesNotHideSuccessfulBriefingOrOtherSections() async throws {
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/watchlists": request.respond(200, #"[{"id":1,"version":1,"payload":{"name":"Main","symbols":["AAPL"]}}]"#)
            case "/api/quotes": request.respond(502, #"{"error":"Quotes unavailable"}"#)
            case "/api/briefings/current": request.respond(200, #"{"date":"2026-10-24","summary":"Ready","indexes":[],"headlines":[],"warnings":[]}"#)
            default: request.respondFixture()
            }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession(); await model.refresh()
        #expect(model.briefing?.summary == "Ready"); #expect(model.sectionUpdated[.briefing] != nil)
        #expect(model.sectionErrors[.watchlist] != nil); #expect(model.sectionErrors[.briefing] == nil)
        #expect(model.alerts.count == 1)
    }
    @Test func signOutCancelsPendingRefreshAndClearsPrivateState() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/watchlists" { gate.hold(request) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (model, vault) = try fixture(); await model.restoreSession()
        let refresh = Task { await model.refresh() }
        await eventually { gate.isHeld && model.sectionUpdated[.alerts] != nil }
        await model.signOut(); gate.release(200, #"[{"id":1,"version":1,"payload":{"name":"Old","symbols":["IBM"]}}]"#)
        await refresh.value
        #expect(!model.signedIn); #expect(model.alerts.isEmpty); #expect(model.sharedLists.isEmpty)
        #expect(model.loadingSections.isEmpty); #expect(model.sectionUpdated.isEmpty); #expect(vault.data == nil)
    }
    @Test func phoneHealthReportsPartialFailuresAndBackupFailuresIndependently() async throws {
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/status": request.respond(200, #"{"ok":true,"database":"sqlite"}"#)
            case "/api/data/schedule": request.respond(200, #"{"policy":{"enabled":true},"status":{"lastSuccess":null,"error":"private diagnostic"}}"#)
            case "/api/mobile/push": request.respond(503, #"{"error":"Push status unavailable"}"#)
            default: request.respondFixture()
            }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession(); await model.checkHealth()
        #expect(model.health["Connection"]?.contains("Connected") == true)
        #expect(model.health["Backups"]?.contains("failed") == true)
        #expect(model.health["Native push"]?.contains("unavailable") == true)
        #expect(model.signedIn); #expect(!model.checkingHealth)
    }
    @Test func expiredAuthorizationClearsAllConcurrentSectionState() async throws {
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/alerts" { request.respond(401, #"{"error":"Revoked"}"#) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (model, vault) = try fixture(); await model.restoreSession(); await model.refresh()
        #expect(!model.signedIn); #expect(vault.data == nil); #expect(model.error != nil)
        #expect(model.sectionUpdated.isEmpty); #expect(model.sectionErrors.isEmpty); #expect(model.loadingSections.isEmpty)
    }
    private func eventually(_ condition: () -> Bool) async {
        for _ in 0..<300 { if condition() { return }; try? await Task.sleep(for: .milliseconds(10)) }
        #expect(condition(), "Independent sections should complete while another request is held")
    }
}
@MainActor private final class MemoryCredentials: CredentialStorage {
    var data: Data?
    func load(_ server: String) throws -> Data? { data }
    func save(_ data: Data, server: String) throws { self.data = data }
    func remove(_ server: String) { data = nil }
}
private final class ResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var held: ModelProtocol?
    var isHeld: Bool { lock.withLock { held != nil } }
    func hold(_ request: ModelProtocol) { lock.withLock { held = request } }
    func release(_ status: Int, _ body: String) { let request = lock.withLock { let value = held; held = nil; return value }; request?.respond(status, body) }
}
private final class ModelProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (ModelProtocol) -> Void)?
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(self) }
    override func stopLoading() { lock.withLock { stopped = true } }
    func respond(_ status: Int, _ body: String) {
        guard !lock.withLock({ stopped }) else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    func respondFixture() {
        switch request.url?.path {
        case "/api/mobile/session": respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#)
        case "/api/watchlists": respond(200, #"[{"id":1,"version":1,"payload":{"name":"Main","symbols":[]}}]"#)
        case "/api/portfolios": respond(200, "[]")
        case "/api/alerts": respond(200, #"{"alerts":[{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":100,"label":"Test","armed":1}]}"#)
        default: respond(404, #"{"error":"Unexpected fixture path"}"#)
        }
    }
}
