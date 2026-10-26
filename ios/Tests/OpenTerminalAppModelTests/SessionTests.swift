import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct SessionTests {
    private let first = "https://first.example.com"
    private let second = "https://second.example.com"
    private let renewed = #"{"id":"saved","name":"Saved phone","expiresAt":"2030-01-01T00:00:00Z"}"#
    private let paired = #"{"id":"fresh","name":"New phone","token":"fresh-test-token","expiresAt":"2030-01-01T00:00:00Z"}"#
    private func fixture() throws -> (TerminalModel, SessionVault, SessionDefaults) {
        let vault = SessionVault(), defaults = SessionDefaults(suiteName: "session-memory-\(UUID())")!
        vault.values[first] = try JSONEncoder().encode(MobileCredential(id: "saved", name: "Saved phone", token: "saved-test-token", expiresAt: "2030-01-01T00:00:00Z"))
        let model = TerminalModel(defaults: defaults, credentials: vault) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SessionProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = first
        return (model, vault, defaults)
    }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(condition(), "The expected request did not start")
    }

    @Test func signingOutDuringRestoreCannotRestoreAuthorizationOrKeychain() async throws {
        let gate = SessionGate()
        SessionProtocol.handler = { gate.hold($0) }; defer { SessionProtocol.handler = nil }
        let (model, vault, defaults) = try fixture()
        let restore = Task { await model.restoreSession() }; try await eventually { gate.isHeld }
        await model.signOut()
        #expect(vault.values[first] == nil)
        #expect(!model.restoring && !model.busy)
        gate.release(200, renewed); await restore.value
        #expect(!model.signedIn && model.api == nil && model.server == nil)
        #expect(vault.values[first] == nil && defaults.string(forKey: "server") == nil)
        #expect(model.error == nil)
    }

    @Test(arguments: [200, 401]) func manualPairingWinsOverAnOlderRestore(response: Int) async throws {
        let gate = SessionGate(), responseBody = paired
        SessionProtocol.handler = { request in
            if request.request.httpMethod == "PUT" { gate.hold(request) }
            else { request.respond(200, responseBody) }
        }; defer { SessionProtocol.handler = nil }
        let (model, vault, _) = try fixture()
        let restore = Task { await model.restoreSession() }; try await eventually { gate.isHeld }
        await model.signIn(password: "owner password")
        #expect(model.signedIn && !model.restoring)
        gate.release(response, response == 200 ? renewed : #"{"error":"Expired"}"#); await restore.value
        let saved = try #require(vault.values[first])
        #expect(try JSONDecoder().decode(MobileCredential.self, from: saved).id == "fresh")
        #expect(model.signedIn && model.server?.origin.absoluteString == first && model.error == nil)
        SessionProtocol.handler = { request in
            #expect(request.request.value(forHTTPHeaderField: "Authorization") == "Bearer fresh-test-token")
            request.respond(200, "[]")
        }
        let _: [Portfolio] = try await #require(model.api).get("/api/portfolios")
    }

    @Test func changingServerDiscardsAnOldPairAndRevokesOnlyItsNewToken() async throws {
        let gate = SessionGate(), deleted = SessionGate(), responseBody = paired
        SessionProtocol.handler = { request in
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "POST" { gate.hold(request) }
                else { deleted.hold(request) }
            } else { request.respond(201, responseBody) }
        }; defer { SessionProtocol.handler = nil }
        let (model, vault, defaults) = try fixture()
        let old = Task { await model.signIn(password: "first password") }; try await eventually { gate.isHeld }
        model.serverText = second
        #expect(!model.busy && !model.restoring)
        await model.signIn(password: "second password")
        #expect(model.signedIn && model.server?.origin.absoluteString == second)
        gate.release(201, paired); try await eventually { deleted.isHeld }
        #expect(deleted.request?.httpMethod == "DELETE")
        #expect(deleted.request?.url?.host == "first.example.com")
        #expect(deleted.request?.value(forHTTPHeaderField: "Authorization") == "Bearer fresh-test-token")
        deleted.release(200, #"{"ok":true}"#); await old.value
        let savedFirst = try #require(vault.values[first])
        #expect(try JSONDecoder().decode(MobileCredential.self, from: savedFirst).id == "saved")
        #expect(vault.values[second] != nil)
        #expect(model.signedIn && model.server?.origin.absoluteString == second && model.error == nil)
        #expect(defaults.string(forKey: "server") == second)
    }

    @Test func signingOutDuringPairingRevokesTheLateCredentialWithoutSavingIt() async throws {
        let gate = SessionGate(), deleted = SessionGate()
        SessionProtocol.handler = { request in
            if request.request.httpMethod == "POST" { gate.hold(request) }
            else { deleted.hold(request) }
        }; defer { SessionProtocol.handler = nil }
        let (model, vault, _) = try fixture()
        let pair = Task { await model.signIn(password: "owner password") }; try await eventually { gate.isHeld }
        await model.signOut(); gate.release(201, paired)
        try await eventually { deleted.isHeld }; deleted.release(200, #"{"ok":true}"#); await pair.value
        #expect(!model.signedIn && !model.busy && !model.restoring && model.api == nil)
        #expect(vault.values.isEmpty && model.error == nil)
    }

    @Test(arguments: [false, true]) func changingServerDuringRestoreDiscardsTheOldAttempt(returnToOriginal: Bool) async throws {
        let gate = SessionGate()
        SessionProtocol.handler = { gate.hold($0) }; defer { SessionProtocol.handler = nil }
        let (model, vault, _) = try fixture()
        let restore = Task { await model.restoreSession() }; try await eventually { gate.isHeld }
        model.serverText = second
        if returnToOriginal { model.serverText = first }
        gate.release(200, renewed); await restore.value
        #expect(!model.signedIn && !model.restoring && model.server == nil)
        #expect(model.serverText == (returnToOriginal ? first : second))
        #expect(vault.values[second] == nil)
        // Switching addresses must not delete the reusable saved credential for the first server.
        #expect(vault.values[first] != nil)
    }

    @Test func duplicateReconnectsAndSignedInRestoresDoNotRenewAgain() async throws {
        let gate = SessionGate()
        SessionProtocol.handler = { gate.hold($0) }; defer { SessionProtocol.handler = nil }
        let (model, _, _) = try fixture()
        let restore = Task { await model.restoreSession() }; try await eventually { gate.isHeld }
        await model.restoreSession(force: true)
        #expect(gate.count == 1 && model.restoring)
        gate.release(200, renewed); await restore.value
        await model.restoreSession(force: true)
        #expect(gate.count == 1 && model.signedIn && !model.restoring)
    }

    @Test func anOldRestoreCannotClearANewerPairingSpinnerOrError() async throws {
        let restoreGate = SessionGate(), pairGate = SessionGate()
        SessionProtocol.handler = { request in
            if request.request.httpMethod == "PUT" { restoreGate.hold(request) }
            else { pairGate.hold(request) }
        }; defer { SessionProtocol.handler = nil }
        let (model, _, _) = try fixture()
        let restore = Task { await model.restoreSession() }; try await eventually { restoreGate.isHeld }
        let pair = Task { await model.signIn(password: "owner password") }; try await eventually { pairGate.isHeld }
        await model.restoreSession(force: true) // Reconnect cannot supersede a manual pairing.
        restoreGate.release(401, #"{"error":"Expired"}"#); await restore.value
        #expect(model.busy && !model.restoring && !model.signedIn && model.error == nil)
        pairGate.release(201, paired); await pair.value
        #expect(model.signedIn && !model.busy && model.error == nil)
    }

    @Test func equivalentOriginEditsKeepTheCurrentPairing() async throws {
        let gate = SessionGate()
        SessionProtocol.handler = { gate.hold($0) }; defer { SessionProtocol.handler = nil }
        let (model, vault, defaults) = try fixture(); vault.values = [:]
        let pair = Task { await model.signIn(password: "owner password") }; try await eventually { gate.isHeld }
        model.serverText = "  \(first)/  "
        #expect(model.busy)
        gate.release(201, paired); await pair.value
        #expect(model.signedIn && model.server?.origin.absoluteString == first)
        #expect(vault.values[first] != nil && defaults.string(forKey: "server") == first)
    }

    @Test func canceledRestoreKeepsSavedAuthorizationWithoutShowingAnError() async throws {
        let gate = SessionGate()
        SessionProtocol.handler = { gate.hold($0) }; defer { SessionProtocol.handler = nil }
        let (model, vault, _) = try fixture()
        let restore = Task { await model.restoreSession() }; try await eventually { gate.isHeld }
        restore.cancel(); await restore.value; gate.release(200, renewed)
        #expect(!model.signedIn && !model.restoring && model.error == nil && model.server == nil)
        #expect(vault.values[first] != nil)
    }
}

@MainActor private final class SessionVault: CredentialStorage {
    var values: [String: Data] = [:]
    func load(_ server: String) throws -> Data? { values[server] }
    func save(_ data: Data, server: String) throws { values[server] = data }
    func remove(_ server: String) { values[server] = nil }
}
private final class SessionDefaults: UserDefaults, @unchecked Sendable {
    private var values: [String: Any] = [:]
    override func set(_ value: Any?, forKey key: String) { values[key] = value }
    override func string(forKey key: String) -> String? { values[key] as? String }
}
private final class SessionGate: @unchecked Sendable {
    private let lock = NSLock()
    private var held: SessionProtocol?
    private var total = 0
    var isHeld: Bool { lock.withLock { held != nil } }
    var count: Int { lock.withLock { total } }
    var request: URLRequest? { lock.withLock { held?.request } }
    func hold(_ request: SessionProtocol) { lock.withLock { total += 1; held = request } }
    func release(_ status: Int, _ body: String) {
        let request = lock.withLock { let old = held; held = nil; return old }
        request?.respond(status, body)
    }
}
private final class SessionProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (SessionProtocol) -> Void)?
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
}
