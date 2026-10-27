import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct DeviceManagementTests {
    private func fixture() async throws -> (TerminalModel, DeviceRequests) {
        let requests = DeviceRequests()
        DeviceProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let model = TerminalModel(defaults: DeviceDefaults(suiteName: "devices-memory-\(UUID())")!, credentials: DeviceCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [DeviceProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession()
        await model.loadDevices(session: model.sessionID); requests.clear()
        return (model, requests)
    }
    private func peer(_ model: TerminalModel) throws -> MobileDeviceInfo { try #require(model.devices.first { $0.id == "peer" }) }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(condition(), "Expected device request did not complete")
    }

    @Test func deviceListIdentifiesTheCurrentDeviceWithoutPersistingAccountData() async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        #expect(model.currentDeviceID == "self" && model.devices.map(\.id) == ["self", "peer"])
        #expect(!model.loadingDevices && model.deviceListError == nil && requests.all.isEmpty)
    }

    @Test func confirmedRevocationFinishesBeforeListLoadingAndBlocksDuplicateWrites() async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try peer(model), write = DeviceGate(), list = DeviceGate(), session = model.sessionID
        DeviceProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { list.hold(request) } else { write.hold(request) }
        }
        let action = Task { await model.revoke(target, session: session) }; try await eventually { write.waiting }
        #expect(model.pendingDeviceRevocations == [target.id] && model.signedIn)
        await model.revoke(target, session: session)
        #expect(requests.all.count == 1 && requests.all.first?.url?.path == "/api/mobile/devices/peer")
        write.release(200, #"{"ok":true}"#); await action.value
        #expect(model.pendingDeviceRevocations.isEmpty && model.deviceActionErrors.isEmpty && model.signedIn && model.currentDeviceID == "self")
        let revoked = try peer(model)
        #expect(revoked.revoked_at != nil && revoked.name == target.name && revoked.expires_at == target.expires_at)
        #expect(model.devices.first { $0.id == "self" }?.revoked_at == nil)
        try await eventually { list.waiting }
        #expect(requests.all.count == 2)
        list.releasePage(revoked: true); try await eventually { !model.loadingDevices }
    }

    @Test(arguments: [200, 401]) func olderSnapshotsCannotUndoConfirmedRevocationOrSignOutTheSession(status: Int) async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try peer(model), old = DeviceGate(), latest = DeviceGate(), session = model.sessionID
        DeviceProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" {
                if requests.all.filter({ $0.httpMethod == "GET" }).count == 1 { old.hold(request) } else { latest.hold(request) }
            } else { request.fixture() }
        }
        let refresh = Task { await model.loadDevices(session: session) }; try await eventually { old.waiting }
        await model.revoke(target, session: session); try await eventually { latest.waiting }
        if status == 200 { old.releasePage() } else { old.release(status, "") }
        await refresh.value
        #expect(model.signedIn && model.error == nil && model.deviceListError == nil && model.loadingDevices)
        #expect(try peer(model).revoked_at != nil)
        latest.releasePage(revoked: true); try await eventually { !model.loadingDevices }
    }

    @Test(arguments: [200, 401, 503]) func newerDeviceListWinsOverAnOlderSuccessOrError(status: Int) async throws {
        let (model, _) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let old = DeviceGate(), session = model.sessionID
        DeviceProtocol.handler = { old.hold($0) }
        let refresh = Task { await model.loadDevices(session: session) }; try await eventually { old.waiting }
        DeviceProtocol.handler = { $0.page(revoked: true) }; await model.loadDevices(session: session)
        if status == 200 { old.releasePage() } else { old.release(status, "") }
        await refresh.value
        #expect(model.signedIn && model.error == nil && model.deviceListError == nil && !model.loadingDevices)
        #expect(try peer(model).revoked_at != nil)
    }

    @Test func failedRevocationPreservesAccessStateAndAllowsAnExplicitRetry() async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try peer(model), session = model.sessionID
        DeviceProtocol.handler = { request in requests.append(request.request); request.respond(503, #"{"error":"Try later"}"#) }
        await model.revoke(target, session: session)
        #expect(try peer(model) == target)
        #expect(model.pendingDeviceRevocations.isEmpty && model.deviceActionErrors[target.id] != nil && model.deviceListError == nil)
        #expect(model.signedIn && model.error == nil && !model.reconnecting && requests.all.count == 1)
        DeviceProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { request.page(revoked: true) } else { request.fixture() }
        }
        await model.revoke(target, session: session)
        try await eventually { requests.all.filter { $0.httpMethod == "GET" }.count == 1 && !model.loadingDevices }
        #expect(model.deviceActionErrors.isEmpty && model.pendingDeviceRevocations.isEmpty)
        #expect(try peer(model).revoked_at != nil)
    }

    @Test func failedListReadKeepsCachedDevicesAndClearsItsErrorOnRetry() async throws {
        let (model, _) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let before = model.devices
        DeviceProtocol.handler = { $0.respond(503, #"{"error":"Device list unavailable"}"#) }
        await model.loadDevices(session: model.sessionID)
        #expect(model.devices == before && model.deviceListError != nil && !model.loadingDevices)
        #expect(model.signedIn && model.error == nil && !model.reconnecting)
        DeviceProtocol.handler = { $0.page() }; await model.loadDevices(session: model.sessionID)
        #expect(model.deviceListError == nil && model.devices == before)
    }

    @Test func failedFollowUpListDoesNotUndoAnAcknowledgedRevocation() async throws {
        let (model, _) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try peer(model)
        DeviceProtocol.handler = { request in
            if request.request.httpMethod == "GET" { request.respond(503, #"{"error":"List unavailable"}"#) } else { request.fixture() }
        }
        await model.revoke(target, session: model.sessionID); try await eventually { model.deviceListError != nil }
        #expect(model.signedIn && model.pendingDeviceRevocations.isEmpty && model.deviceActionErrors.isEmpty)
        #expect(try peer(model).revoked_at != nil)
    }

    @Test func currentDeviceRevocationSignsOutOnlyAfterAcknowledgement() async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try #require(model.devices.first { $0.id == model.currentDeviceID }), write = DeviceGate(), logout = DeviceGate()
        DeviceProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/mobile/devices/self" { write.hold(request) } else { logout.hold(request) }
        }
        let action = Task { await model.revoke(target, session: model.sessionID) }; try await eventually { write.waiting }
        #expect(model.signedIn && model.currentDeviceID == "self" && model.pendingDeviceRevocations == ["self"])
        write.release(200, #"{"ok":true}"#); try await eventually { logout.waiting }
        #expect(!model.signedIn && model.currentDeviceID == nil && model.devices.isEmpty && model.pendingDeviceRevocations.isEmpty)
        #expect(model.deviceListError == nil && model.deviceActionErrors.isEmpty)
        logout.release(401, ""); await action.value
        #expect(model.error == nil && requests.all.count == 2)
    }

    @Test(arguments: [false, true], [200, 401]) func oldRevocationAndConfirmationCannotAffectANewerConnection(selfTarget: Bool, status: Int) async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try #require(model.devices.first { $0.id == (selfTarget ? "self" : "peer") })
        let old = DeviceGate(), logout = DeviceGate(), latest = DeviceGate(), oldSession = model.sessionID
        DeviceProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.host == "first.example.com" {
                if request.request.url?.path == "/api/mobile/session" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.httpMethod == "DELETE" { latest.hold(request) }
            else { request.fixture() }
        }
        let oldAction = Task { await model.revoke(target, session: oldSession) }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(model.pendingDeviceRevocations.isEmpty && !model.loadingDevices && model.deviceActionErrors.isEmpty)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        let session = model.sessionID; await model.loadDevices(session: session)
        await model.revoke(target, session: oldSession); #expect(!latest.waiting)
        let current = try peer(model), action = Task { await model.revoke(current, session: session) }
        try await eventually { latest.waiting }
        old.release(status, #"{"ok":true}"#); await oldAction.value
        #expect(model.signedIn && model.server?.origin.host == "second.example.com" && model.error == nil)
        #expect(model.pendingDeviceRevocations == ["peer"] && model.deviceActionErrors.isEmpty && model.deviceListError == nil)
        #expect(try peer(model).revoked_at == nil)
        logout.release(200, #"{"ok":true}"#); await signOut.value
        DeviceProtocol.handler = { request in requests.append(request.request); request.page(revoked: true) }
        latest.release(200, #"{"ok":true}"#); await action.value
        try await eventually { requests.all.filter { $0.url?.host == "second.example.com" && $0.url?.path == "/api/mobile/devices" }.count == 2 && !model.loadingDevices }
        #expect(model.pendingDeviceRevocations.isEmpty && model.signedIn)
    }

    @Test(arguments: ["GET", "DELETE"]) func currentAuthorizationFailureClearsDeviceStateAndRequiresSignIn(method: String) async throws {
        let (model, _) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try peer(model)
        DeviceProtocol.handler = { request in
            if request.request.url?.path.hasPrefix("/api/mobile/devices") == true { request.respond(401, "") } else { request.fixture() }
        }
        if method == "GET" { await model.loadDevices(session: model.sessionID) } else { await model.revoke(target, session: model.sessionID) }
        #expect(!model.signedIn && model.error != nil && model.devices.isEmpty && model.currentDeviceID == nil)
        #expect(!model.loadingDevices && model.pendingDeviceRevocations.isEmpty && model.deviceListError == nil && model.deviceActionErrors.isEmpty)
    }

    @Test func missingAndAlreadyRevokedDevicesCannotBeWrittenFromStaleControls() async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try peer(model), revoked = target.markingRevoked(at: "2030-01-01T00:00:00Z")
        model.devices = [revoked]
        await model.revoke(target, session: model.sessionID); await model.revoke(revoked, session: model.sessionID)
        model.devices = []; await model.revoke(target, session: model.sessionID)
        #expect(requests.all.isEmpty && model.pendingDeviceRevocations.isEmpty && model.deviceActionErrors.isEmpty)
    }

    @Test(arguments: ["GET", "DELETE"]) func cancellationClearsProgressWithoutAnErrorOrAutomaticRetry(method: String) async throws {
        let (model, requests) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let target = try peer(model), gate = DeviceGate(), session = model.sessionID
        DeviceProtocol.handler = { request in requests.append(request.request); gate.hold(request) }
        let canceled = Task { await Task.yield(); await model.revoke(target, session: session) }; canceled.cancel(); await canceled.value
        #expect(requests.all.isEmpty)
        let action = Task {
            if method == "GET" { await model.loadDevices(session: session) } else { await model.revoke(target, session: session) }
        }
        try await eventually { gate.waiting }; action.cancel(); await action.value
        #expect(!model.loadingDevices && model.pendingDeviceRevocations.isEmpty && model.deviceListError == nil && model.deviceActionErrors.isEmpty)
        #expect(try peer(model) == target)
        #expect(requests.all.count == 1)
        gate.release(200, #"{"ok":true}"#)
    }

    @Test(arguments: [200, 401]) func oldListCannotReplaceANewConnectionsPendingLoad(status: Int) async throws {
        let (model, _) = try await fixture(); defer { DeviceProtocol.handler = nil }
        let old = DeviceGate(), logout = DeviceGate(), latest = DeviceGate(), session = model.sessionID
        DeviceProtocol.handler = { request in
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.url?.path == "/api/mobile/devices" { latest.hold(request) }
            else { request.fixture() }
        }
        let refresh = Task { await model.loadDevices(session: session) }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        let current = model.sessionID, next = Task { await model.loadDevices(session: current) }; try await eventually { latest.waiting }
        if status == 200 { old.releasePage(revoked: true) } else { old.release(status, "") }; await refresh.value
        #expect(model.signedIn && model.devices.isEmpty && model.loadingDevices && model.deviceListError == nil && model.error == nil)
        logout.release(200, #"{"ok":true}"#); await signOut.value
        latest.releasePage(); await next.value
        #expect(!model.loadingDevices && model.devices.map(\.id) == ["self", "peer"])
    }
}

@MainActor private final class DeviceCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "self", name: "This phone", token: "test-device-management-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class DeviceDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
}
private final class DeviceRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { values } }
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func clear() { lock.withLock { values = [] } }
}
private final class DeviceGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: DeviceProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: DeviceProtocol) { lock.withLock { held = value } }
    private func take() -> DeviceProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func releasePage(revoked: Bool = false) { take()?.page(revoked: revoked) }
}
private final class DeviceProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (DeviceProtocol) -> Void)?
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
        if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#) }
        else if request.url?.path == "/api/mobile/session" { respond(200, #"{"id":"self","name":"This phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if request.url?.path == "/api/mobile/devices" { page() }
        else { respond(404, #"{"error":"Unexpected device fixture"}"#) }
    }
    func page(revoked: Bool = false) {
        let rows: [[String: Any]] = [
            ["id": "self", "name": "This phone", "expires_at": "2030-01-01T00:00:00Z", "revoked_at": NSNull()],
            ["id": "peer", "name": "Other phone", "expires_at": "2030-01-01T00:00:00Z", "revoked_at": revoked ? "2026-01-01T00:00:00Z" : NSNull()],
        ]
        let data = try! JSONSerialization.data(withJSONObject: rows); respond(200, String(decoding: data, as: UTF8.self))
    }
}
