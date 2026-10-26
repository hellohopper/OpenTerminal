import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct NotificationRoutingTests {
    private let origin = "https://fixture.example.com"
    private let device = "11111111-1111-4111-8111-111111111111"
    private let otherDevice = "22222222-2222-4222-8222-222222222222"
    private func target(_ symbol: String = "AAPL", origin: String = "https://fixture.example.com", device: String = "11111111-1111-4111-8111-111111111111") throws -> NotificationResearchTarget {
        try #require(NotificationResearchTarget(userInfo: ["symbol": symbol, "serverOrigin": origin, "deviceId": device]))
    }
    private func fixture(inbox: ResearchNotificationInbox = ResearchNotificationInbox(), selected: String? = "https://fixture.example.com") throws -> (TerminalModel, ResearchNotificationInbox, RoutingDefaults) {
        RoutingProtocol.handler = { $0.fixture() }
        let defaults = RoutingDefaults(suiteName: "routing-memory-\(UUID())")!
        defaults.set(selected, forKey: "server")
        let model = TerminalModel(defaults: defaults, credentials: RoutingCredentials(), notificationInbox: inbox) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RoutingProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        return (model, inbox, defaults)
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(predicate(), "Expected renewal did not start")
    }

    @Test func decodesTheSharedBackendNotificationFixture() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("tests/fixtures/native-notification.json")))
        let payload = try #require(json as? [AnyHashable: Any])
        let route = try #require(NotificationResearchTarget(userInfo: payload))
        #expect(route.symbol == "AAPL" && route.deviceID == device && route.server.origin.absoluteString == origin)
    }

    @Test func rejectsLegacyOrMalformedTargetsAndNormalizesTickers() throws {
        let invalid: [[AnyHashable: Any]] = [
            ["symbol": "AAPL"],
            ["symbol": "AAPL", "serverOrigin": origin, "deviceId": "opaque-token.private-secret"],
            ["symbol": "<script>", "serverOrigin": origin, "deviceId": device],
            ["symbol": "AAPL", "serverOrigin": "https://user:secret@fixture.example.com", "deviceId": device],
            ["symbol": "AAPL", "serverOrigin": "http://192.168.1.1", "deviceId": device],
            ["symbol": "AAPL", "serverOrigin": origin + "/api", "deviceId": device],
            ["symbol": "AAPL", "serverOrigin": origin + "?secret=x", "deviceId": device]
        ]
        for payload in invalid { #expect(NotificationResearchTarget(userInfo: payload) == nil) }
        #expect(try target(" aapl ").symbol == "AAPL")
    }

    @Test func opensOnlyTheAuthorizedServerAndDevice() async throws {
        let (model, inbox, _) = try fixture(); defer { RoutingProtocol.handler = nil }
        await model.restoreSession()
        inbox.receive(try target()); #expect(model.researchSymbol == "AAPL")
        inbox.receive(try target("MSFT", origin: "https://other.example.com"))
        inbox.receive(try target("SPY", device: otherDevice))
        #expect(model.researchSymbol == "AAPL" && model.server?.origin.absoluteString == origin)
        inbox.receive(try target("MSFT", origin: "https://FIXTURE.example.com:443/"))
        #expect(model.researchSymbol == "MSFT")
        #expect(try target(origin: "http://localhost:3100").matches(ServerConnection("http://127.0.0.1:3100")) == false)
    }

    @Test func coldLaunchTapIsRetainedUntilSuccessfulAuthorizationAndNotPersisted() async throws {
        let inbox = ResearchNotificationInbox(); inbox.receive(try target())
        let (model, _, defaults) = try fixture(inbox: inbox); defer { RoutingProtocol.handler = nil }
        #expect(!model.signedIn && model.researchSymbol == nil)
        await model.restoreSession()
        #expect(model.signedIn && model.researchSymbol == "AAPL")
        #expect(defaults.strings == ["server": origin])
    }

    @Test func tapDuringRenewalWaitsForTheMatchingDevice() async throws {
        let (model, inbox, _) = try fixture(); defer { RoutingProtocol.handler = nil }
        let gate = RoutingGate(); RoutingProtocol.handler = { gate.hold($0) }
        let restore = Task { await model.restoreSession() }; try await eventually { gate.waiting }
        inbox.receive(try target("SPY")); #expect(model.researchSymbol == nil)
        gate.releaseFixture(); await restore.value
        #expect(model.signedIn && model.researchSymbol == "SPY")
    }

    @Test func signOutAndFreshPairingCannotReopenAnOldNotification() async throws {
        let (model, inbox, _) = try fixture(); defer { RoutingProtocol.handler = nil }
        await model.restoreSession(); inbox.receive(try target()); await model.signOut()
        #expect(model.researchSymbol == nil)
        // An old tap while signed out must not transfer to a newly paired device identity.
        inbox.receive(try target()); await model.signIn(password: "owner password")
        #expect(model.signedIn && model.researchSymbol == nil)
        inbox.receive(try target("MSFT", device: otherDevice)); #expect(model.researchSymbol == "MSFT")
    }

    @Test func switchingAwayAndBackDiscardsTheQueuedTarget() async throws {
        let (model, inbox, _) = try fixture(); defer { RoutingProtocol.handler = nil }
        inbox.receive(try target()); model.serverText = "https://other.example.com"; model.serverText = origin
        await model.restoreSession()
        #expect(model.signedIn && model.researchSymbol == nil)
    }

    @Test func aForeignTapNeverSelectsItsServerOrTransfersToALaterLogin() async throws {
        let (model, inbox, _) = try fixture(); defer { RoutingProtocol.handler = nil }
        inbox.receive(try target("SPY", origin: "https://other.example.com"))
        #expect(model.serverText == origin)
        model.serverText = "https://other.example.com"; await model.restoreSession()
        #expect(model.signedIn && model.researchSymbol == nil)
    }

    @Test func aNewerForeignTapCancelsAnEarlierQueuedNavigation() async throws {
        let (model, inbox, _) = try fixture(); defer { RoutingProtocol.handler = nil }
        inbox.receive(try target()); inbox.receive(try target("SPY", origin: "https://other.example.com"))
        await model.restoreSession()
        #expect(model.signedIn && model.serverText == origin && model.researchSymbol == nil)
    }

    @Test func connectionFailureRetainsOnlyAnInMemoryTapForAnExplicitRetry() async throws {
        let (model, inbox, _) = try fixture(); defer { RoutingProtocol.handler = nil }
        inbox.receive(try target("SPY"))
        RoutingProtocol.handler = { $0.respond(503, #"{"error":"Backend unavailable"}"#) }
        await model.restoreSession(); #expect(!model.signedIn && model.researchSymbol == nil)
        RoutingProtocol.handler = { $0.fixture() }; await model.restoreSession(force: true)
        #expect(model.signedIn && model.researchSymbol == "SPY")
    }

    @Test func aTapCannotPrefillAnUnconfiguredServer() async throws {
        let inbox = ResearchNotificationInbox(); inbox.receive(try target())
        let (model, _, _) = try fixture(inbox: inbox, selected: nil); defer { RoutingProtocol.handler = nil }
        #expect(model.serverText.isEmpty && model.researchSymbol == nil)
        model.serverText = origin; await model.restoreSession()
        #expect(model.signedIn && model.researchSymbol == nil)
    }

    @Test func inboxKeepsOnlyTheLatestTapAndDrainsItOnce() throws {
        let inbox = ResearchNotificationInbox()
        inbox.receive(try target()); inbox.receive(try target("MSFT"))
        var consumer: RoutingConsumer? = RoutingConsumer(); inbox.attach(consumer!)
        #expect(consumer?.symbols == ["MSFT"])
        consumer = nil
        inbox.receive(try target("SPY"))
        let replacement = RoutingConsumer(); inbox.attach(replacement)
        #expect(replacement.symbols == ["SPY"])
        let another = RoutingConsumer(); inbox.attach(another)
        #expect(another.symbols.isEmpty)
    }
}

@MainActor private final class RoutingConsumer: ResearchNotificationConsumer {
    var symbols: [String] = []
    func receiveNotification(_ target: NotificationResearchTarget) { symbols.append(target.symbol) }
}
@MainActor private final class RoutingCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "11111111-1111-4111-8111-111111111111", name: "Phone", token: "routing-test-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class RoutingDefaults: UserDefaults, @unchecked Sendable {
    var strings: [String: String] = [:]
    override func set(_ value: Any?, forKey key: String) { strings[key] = value as? String }
    override func string(forKey key: String) -> String? { strings[key] }
}
private final class RoutingGate: @unchecked Sendable {
    private let lock = NSLock(); private var request: RoutingProtocol?
    var waiting: Bool { lock.withLock { request != nil } }
    func hold(_ value: RoutingProtocol) { lock.withLock { request = value } }
    func releaseFixture() { let old = lock.withLock { let old = request; request = nil; return old }; old?.fixture() }
}
private final class RoutingProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (RoutingProtocol) -> Void)?
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
    func fixture() {
        if request.httpMethod == "POST" {
            respond(201, #"{"id":"22222222-2222-4222-8222-222222222222","name":"Fresh phone","token":"fresh-routing-token","expiresAt":"2030-01-01T00:00:00Z"}"#)
        } else if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#) }
        else { respond(200, #"{"id":"11111111-1111-4111-8111-111111111111","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
    }
}
