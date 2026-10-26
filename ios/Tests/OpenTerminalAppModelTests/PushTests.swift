import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct PushTests {
    private func fixture() async throws -> (TerminalModel, FakeNotifications, PushRequests) {
        let requests = PushRequests()
        PushProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let notifications = FakeNotifications()
        let model = TerminalModel(defaults: PushDefaults(suiteName: "push-memory-\(UUID())")!, credentials: PushCredentials(), notifications: notifications) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PushProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession()
        #expect(model.signedIn)
        requests.clear()
        return (model, notifications, requests)
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(predicate(), "Expected operation did not start")
    }
    private func switchServer(_ model: TerminalModel) async {
        await model.signOut(); model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
    }

    @Test func explicitEnablePreservesQuietHoursAndCurrentPolicyVersion() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        await model.enableNotifications()
        #expect(notifications.permissionRequests == 1 && notifications.registrations == 1)
        let write = try #require(requests.all.first { $0.url?.path == "/api/notifications/settings" })
        let body = try #require(PushProtocol.body(write))
        #expect(body["enabled"] as? Bool == true && body["version"] as? Int == 7)
        #expect(body["quietStart"] as? String == "22:30" && body["quietEnd"] as? String == "07:15")
        #expect(body["timezone"] as? String == "Asia/Tokyo")
        #expect(!model.registeringPush && model.pushMessage?.contains("registered") == true)
    }

    @Test func automaticRegistrationNeverEnablesServerDelivery() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        await model.registerExistingPush()
        #expect(notifications.permissionRequests == 0 && notifications.authorizationChecks == 1 && notifications.registrations == 1)
        #expect(requests.all.contains { $0.url?.path == "/api/mobile/push" && $0.httpMethod == "POST" })
        #expect(!requests.all.contains { $0.url?.path.hasPrefix("/api/notifications") == true })
    }

    @Test(arguments: [false, true]) func unconfiguredServerNeverRequestsSystemRegistration(explicit: Bool) async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        PushProtocol.handler = { request in requests.append(request.request); request.respond(200, #"{"configured":false}"#) }
        if explicit { await model.enableNotifications() } else { await model.registerExistingPush() }
        #expect(notifications.permissionRequests == 0 && notifications.registrations == 0)
        #expect(!model.registeringPush)
        if explicit { #expect(model.pushMessage?.contains("APNs") == true) } else { #expect(model.pushMessage == nil) }
    }

    @Test func deniedPermissionDoesNotSendATokenOrChangeDelivery() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        notifications.allowed = false; await model.enableNotifications()
        #expect(notifications.registrations == 0 && !model.registeringPush)
        #expect(model.pushMessage?.contains("Allow notifications") == true)
        #expect(requests.all.count == 1)
    }

    @Test func latePermissionGrantAfterLogoutCannotStartRegistration() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        let permission = PushGate<Bool>(); notifications.permission = permission
        let enable = Task { await model.enableNotifications() }; try await eventually { permission.waiting }
        await model.signOut(); permission.release(.success(true)); await enable.value
        #expect(!model.signedIn && model.pushMessage == nil && !model.registeringPush)
        #expect(notifications.registrations == 0)
        #expect(!requests.all.contains { $0.url?.path == "/api/mobile/push" && $0.httpMethod == "POST" })
    }

    @Test func lateSystemTokenDoesNotRegisterOnANewServerOrCarryEnableIntent() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        let token = PushGate<String>(); notifications.token = token
        let enable = Task { await model.enableNotifications() }; try await eventually { token.waiting }
        await switchServer(model); token.release(.success(String(repeating: "a", count: 64))); await enable.value
        #expect(model.signedIn && model.pushMessage == nil && !model.registeringPush)
        #expect(!requests.all.contains { $0.url?.path == "/api/mobile/push" && $0.httpMethod == "POST" })
        notifications.token = nil; await model.registerExistingPush()
        let posts = requests.all.filter { $0.url?.path == "/api/mobile/push" && $0.httpMethod == "POST" }
        #expect(posts.count == 1 && posts.first?.url?.host == "second.example.com")
        #expect(!requests.all.contains { $0.url?.path.hasPrefix("/api/notifications") == true })
    }

    @Test(arguments: [200, 401]) func lateTokenPostCannotAffectANewerSession(status: Int) async throws {
        let (model, _, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        let gate = PushHTTPGate()
        PushProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.host == "first.example.com" && request.request.url?.path == "/api/mobile/push" && request.request.httpMethod == "POST" { gate.hold(request) }
            else { request.fixture() }
        }
        let old = Task { await model.enableNotifications() }; try await eventually { gate.waiting }
        await switchServer(model); await model.registerExistingPush(); model.pushMessage = "New session feedback"
        gate.release(status, #"{"ok":true}"#); await old.value
        #expect(model.signedIn && model.server?.origin.host == "second.example.com")
        #expect(model.pushMessage == "New session feedback" && !model.registeringPush)
        #expect(!requests.all.contains { $0.url?.path.hasPrefix("/api/notifications") == true })
    }

    @Test(arguments: ["GET", "POST"]) func currentPushAuthorizationFailureRequiresSignIn(method: String) async throws {
        let (model, _, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        PushProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/mobile/push" && request.request.httpMethod == method { request.respond(401, #"{"error":"Device revoked"}"#) }
            else { request.fixture() }
        }
        await model.enableNotifications()
        #expect(!model.signedIn && model.api == nil && !model.registeringPush)
        #expect(model.pushMessage == nil && model.error != nil)
        #expect(!requests.all.contains { $0.url?.path.hasPrefix("/api/notifications") == true })
    }

    @Test func latePolicyReadCannotEnableDeliveryAfterLogout() async throws {
        let (model, _, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        let gate = PushHTTPGate()
        PushProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/notifications" { gate.hold(request) }
            else { request.fixture() }
        }
        let old = Task { await model.enableNotifications() }; try await eventually { gate.waiting }
        await switchServer(model); gate.releaseFixture(); await old.value
        #expect(model.signedIn && model.pushMessage == nil)
        #expect(!requests.all.contains { $0.url?.path == "/api/notifications/settings" })
    }

    @Test func duplicateEnableAndAutomaticRequestsShareOneModelOperation() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        let token = PushGate<String>(); notifications.token = token
        let enable = Task { await model.enableNotifications() }; try await eventually { token.waiting }
        await model.enableNotifications(); await model.registerExistingPush()
        #expect(notifications.permissionRequests == 1 && notifications.registrations == 1 && model.registeringPush)
        token.release(.success(String(repeating: "b", count: 64))); await enable.value
        #expect(requests.all.filter { $0.url?.path == "/api/notifications/settings" }.count == 1)
        #expect(!model.registeringPush)
    }

    @Test func failedExplicitRegistrationDoesNotEnableDeliveryOnAutomaticRetry() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        let token = PushGate<String>(); notifications.token = token
        let enable = Task { await model.enableNotifications() }; try await eventually { token.waiting }
        token.release(.failure(URLError(.notConnectedToInternet))); await enable.value
        #expect(!model.registeringPush && model.pushMessage != nil)
        notifications.token = nil; await model.registerExistingPush()
        #expect(!requests.all.contains { $0.url?.path.hasPrefix("/api/notifications") == true })
    }

    @Test func canceledRegistrationCannotPostATokenOrLeaveAProgressMessage() async throws {
        let (model, notifications, requests) = try await fixture(); defer { PushProtocol.handler = nil }
        let token = PushGate<String>(); notifications.token = token
        let enable = Task { await model.enableNotifications() }; try await eventually { token.waiting }
        enable.cancel(); token.release(.success(String(repeating: "c", count: 64))); await enable.value
        #expect(model.signedIn && !model.registeringPush && model.pushMessage == nil)
        #expect(!requests.all.contains { $0.httpMethod == "POST" })
    }

    @Test func nativeBrokerCoalescesRequestsAndCancellationDoesNotCancelOtherWaiters() async throws {
        let broker = NativePushTokens(); var started = 0, firstWaiting = false, secondWaiting = false
        let first = Task { firstWaiting = true; return try await broker.request { started += 1 } }
        let second = Task { secondWaiting = true; return try await broker.request { started += 1 } }
        try await eventually { firstWaiting && secondWaiting }
        first.cancel()
        do { _ = try await first.value; Issue.record("Canceled waiter returned a token") } catch { #expect(error is CancellationError) }
        broker.complete(.success("shared-device-token"))
        #expect(try await second.value == "shared-device-token" && started == 1)
        broker.complete(.success("Duplicate callback is ignored"))
        var loneWaiting = false
        let lone = Task { loneWaiting = true; return try await broker.request { started += 1 } }
        try await eventually { loneWaiting }; lone.cancel()
        do { _ = try await lone.value; Issue.record("Canceled last waiter returned a token") } catch { #expect(error is CancellationError) }
        let retry = try await broker.request { started += 1; broker.complete(.success("after-cancel")) }
        #expect(retry == "after-cancel" && started == 3)
    }

    @Test func nativeBrokerTimeoutAndFailureAllowRetry() async throws {
        let broker = NativePushTokens()
        do {
            _ = try await broker.request(timeout: .milliseconds(10)) {}
            Issue.record("Registration should time out")
        } catch { #expect(error.localizedDescription.contains("timed out")) }
        broker.complete(.success("Late callback is ignored"))
        let failed = Task { try await broker.request { broker.complete(.failure(URLError(.cannotConnectToHost))) } }
        do { _ = try await failed.value; Issue.record("Expected registration failure") } catch { #expect((error as? URLError)?.code == .cannotConnectToHost) }
        let retry = try await broker.request { broker.complete(.success("retry-token")) }
        #expect(retry == "retry-token")
    }
}

@MainActor private final class FakeNotifications: NativeNotificationAccess {
    let supported = true
    var allowed = true
    var permissionRequests = 0, authorizationChecks = 0, registrations = 0
    var permission: PushGate<Bool>?
    var token: PushGate<String>?
    func requestAuthorization() async throws -> Bool { permissionRequests += 1; return try await permission?.wait() ?? allowed }
    func isAuthorized() async -> Bool { authorizationChecks += 1; return allowed }
    func register() async throws -> String { registrations += 1; return try await token?.wait() ?? String(repeating: "a", count: 64) }
}
@MainActor private final class PushGate<Value: Sendable> {
    private var continuation: CheckedContinuation<Value, Error>?
    var waiting: Bool { continuation != nil }
    func wait() async throws -> Value { try await withCheckedThrowingContinuation { continuation = $0 } }
    func release(_ result: Result<Value, Error>) { let old = continuation; continuation = nil; old?.resume(with: result) }
}
@MainActor private final class PushCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "push-test-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class PushDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
}
private final class PushRequests: @unchecked Sendable {
    private let lock = NSLock(); private var requests: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { requests } }
    func append(_ request: URLRequest) { lock.withLock { requests.append(request) } }
    func clear() { lock.withLock { requests = [] } }
}
private final class PushHTTPGate: @unchecked Sendable {
    private let lock = NSLock(); private var request: PushProtocol?
    var waiting: Bool { lock.withLock { request != nil } }
    func hold(_ value: PushProtocol) { lock.withLock { request = value } }
    private func take() -> PushProtocol? { lock.withLock { let old = request; request = nil; return old } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func releaseFixture() { take()?.fixture() }
}
private final class PushProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (PushProtocol) -> Void)?
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
        switch (request.url?.path, request.httpMethod) {
        case ("/api/mobile/session", "PUT"): respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#)
        case ("/api/mobile/session", "DELETE"): respond(200, #"{"ok":true}"#)
        case ("/api/mobile/push", "GET"): respond(200, #"{"configured":true,"environment":"sandbox","topic":"fixture.app"}"#)
        case ("/api/mobile/push", "POST"), ("/api/notifications/settings", "POST"): respond(200, #"{"ok":true}"#)
        case ("/api/notifications", "GET"): respond(200, #"{"settings":{"version":7,"payload":{"quietStart":"22:30","quietEnd":"07:15","timezone":"Asia/Tokyo"}}}"#)
        default: respond(404, #"{"error":"Unexpected push fixture path"}"#)
        }
    }
    static func body(_ request: URLRequest) -> [String: Any]? {
        var data = request.httpBody
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var bytes = [UInt8](repeating: 0, count: 4096), contents = Data()
            while stream.hasBytesAvailable { let count = stream.read(&bytes, maxLength: bytes.count); if count <= 0 { break }; contents.append(contentsOf: bytes.prefix(count)) }
            data = contents
        }
        return data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
}
