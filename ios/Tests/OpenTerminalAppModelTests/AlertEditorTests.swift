import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct AlertEditorTests {
    private func fixture() async throws -> (TerminalModel, AlertRequests) {
        let requests = AlertRequests()
        AlertProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let model = TerminalModel(defaults: AlertDefaults(suiteName: "alert-memory-\(UUID())")!, credentials: AlertCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AlertProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession(); requests.clear()
        return (model, requests)
    }
    private func populate(_ state: AlertEditorState) {
        state.draft = AlertDraft(symbol: " aapl ", threshold: " 200.5 ", label: " Price target ", condition: "PRICE_ABOVE")
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(predicate(), "Expected alert operation did not start")
    }

    @Test func acknowledgedSaveFinishesBeforeTheListRefreshAndPreservesTheRequest() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor, gate = AlertGate(); populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { gate.hold(request) } else { request.fixture() }
        }
        await model.saveAlert(state)
        #expect(!state.saving && !state.hasDraft && state.savedRevision == 1 && state.message == "Alert saved.")
        try await eventually { gate.waiting }
        #expect(requests.all.allSatisfy { $0.url?.path == "/api/alerts" })
        let post = try #require(requests.all.first { $0.httpMethod == "POST" })
        let body = try #require(AlertProtocol.body(post))
        #expect(body["symbol"] as? String == "AAPL" && body["threshold"] as? Double == 200.5)
        #expect(body["label"] as? String == "Price target" && body["condition"] as? String == "PRICE_ABOVE")
        gate.releaseFixture(); try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test func reopenedEditorSharesPendingSaveAndCannotSubmitAgain() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor, gate = AlertGate(); populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { request.fixture() }
        }
        let save = Task { await model.saveAlert(state) }; try await eventually { gate.waiting }
        let reopened = model.alertEditor
        #expect(reopened === state && reopened.saving)
        reopened.discard(); #expect(reopened.hasDraft)
        await model.saveAlert(reopened)
        #expect(requests.all.filter { $0.httpMethod == "POST" }.count == 1)
        gate.releaseFixture(); await save.value
        #expect(!reopened.hasDraft && !reopened.saving && reopened.savedRevision == 1)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [false, true]) func successfulSaveKeepsNewerEditsEvenWhenTheyReturnToTheSameText(returnToOriginal: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor, gate = AlertGate(); populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { request.fixture() }
        }
        let save = Task { await model.saveAlert(state) }; try await eventually { gate.waiting }
        let reopened = model.alertEditor
        reopened.draft.threshold = "250"
        if returnToOriginal { reopened.draft.threshold = " 200.5 " }
        gate.releaseFixture(); await save.value
        #expect(reopened.hasDraft && !reopened.saving && reopened.savedRevision == 1)
        #expect(reopened.draft.threshold == (returnToOriginal ? " 200.5 " : "250"))
        #expect(reopened.message == "Alert saved. Newer edits are kept as a draft.")
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test func failedWriteKeepsItsDraftAndEditingClearsTheErrorForRetry() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); let original = state.draft
        AlertProtocol.handler = { request in requests.append(request.request); request.respond(503, #"{"error":"Retry later"}"#) }
        await model.saveAlert(state)
        #expect(state.draft == original && state.error != nil && !state.saving && state.savedRevision == 0)
        let reopened = model.alertEditor; reopened.draft.label = "Revised target"
        #expect(reopened.error == nil)
        AlertProtocol.handler = { request in requests.append(request.request); request.fixture() }
        await model.saveAlert(reopened)
        #expect(!reopened.hasDraft && reopened.savedRevision == 1)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [201, 401]) func oldSaveCannotDismissClearOrSignOutANewerSession(status: Int) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let oldState = model.alertEditor, post = AlertGate(), logout = AlertGate(), newPost = AlertGate(); populate(oldState)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "POST" { post.hold(request) }
                else if request.request.httpMethod == "DELETE" { logout.hold(request) }
                else { request.fixture() }
            } else if request.request.httpMethod == "POST" { newPost.hold(request) }
            else { request.fixture() }
        }
        let oldSave = Task { await model.saveAlert(oldState) }; try await eventually { post.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(oldState.draft.isEmpty && !oldState.saving)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        let current = model.alertEditor; populate(current); current.draft.label = "Second server target"
        let save = Task { await model.saveAlert(current) }; try await eventually { newPost.waiting }
        post.release(status, #"{"id":1}"#); await oldSave.value
        #expect(model.signedIn && model.server?.origin.host == "second.example.com" && model.error == nil)
        #expect(current.saving && current.draft.label == "Second server target" && current.savedRevision == 0)
        #expect(oldState.message == nil && oldState.error == nil && oldState.savedRevision == 0)
        #expect(!requests.all.contains { $0.url?.host == "first.example.com" && $0.httpMethod == "GET" && $0.url?.path == "/api/alerts" })
        logout.releaseFixture(); await signOut.value
        newPost.releaseFixture(); await save.value
        #expect(!current.hasDraft && current.savedRevision == 1)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test func signedOutEditorCannotRestoreItsDraftOrWriteThroughANewConnection() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let old = model.alertEditor; populate(old); await model.signOut()
        #expect(old.draft.isEmpty && old !== model.alertEditor)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        populate(old); await model.saveAlert(old)
        #expect(model.alertEditor.draft.isEmpty && !model.alertEditor.saving)
        #expect(!requests.all.contains { $0.httpMethod == "POST" })
    }

    @Test func refreshFailureDoesNotTurnAnAcknowledgedWriteIntoASaveError() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { request.respond(503, #"{"error":"List temporarily unavailable"}"#) }
            else { request.fixture() }
        }
        await model.saveAlert(state); try await eventually { model.sectionErrors[.alerts] != nil }
        #expect(!state.hasDraft && !state.saving && state.error == nil && state.savedRevision == 1)
        #expect(state.message == "Alert saved.")
    }

    @Test func currentAuthorizationFailureClearsTheEditorAndRequiresSignIn() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { request.respond(401, #"{"error":"Revoked"}"#) } else { request.fixture() }
        }
        await model.saveAlert(state)
        #expect(!model.signedIn && model.error != nil && state.draft.isEmpty && !state.saving)
        #expect(state !== model.alertEditor && model.alertEditor.draft.isEmpty)
    }

    @Test(arguments: ["0", "-1", "nan", "inf", "1e16", "not-a-price"]) func invalidPricesNeverReachTheBackend(price: String) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.draft.threshold = price
        await model.saveAlert(state)
        #expect(state.error != nil && !state.saving && state.hasDraft && requests.all.isEmpty)
    }

    @Test func invalidTickerConditionAndOverlongUnicodeLabelsAreRejectedWithoutTruncation() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.draft.symbol = "<script>"
        await model.saveAlert(state); #expect(state.error != nil)
        populate(state); state.draft.condition = "OTHER"
        await model.saveAlert(state); #expect(state.error != nil)
        populate(state); state.draft.label = String(repeating: "😀", count: 61)
        await model.saveAlert(state)
        #expect(state.error == "Use a label of up to 120 characters.")
        #expect(state.draft.label == String(repeating: "😀", count: 61) && requests.all.isEmpty)
    }

    @Test func discardingAnUnsavedDraftClearsOnlyTheCurrentEditor() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.error = "Old error"
        state.discard()
        #expect(!state.hasDraft && state.error == nil && state.message == nil && requests.all.isEmpty)
    }
}

@MainActor private final class AlertCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "alert-test-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class AlertDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
}
private final class AlertRequests: @unchecked Sendable {
    private let lock = NSLock(); private var requests: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { requests } }
    func append(_ request: URLRequest) { lock.withLock { requests.append(request) } }
    func clear() { lock.withLock { requests = [] } }
}
private final class AlertGate: @unchecked Sendable {
    private let lock = NSLock(); private var request: AlertProtocol?
    var waiting: Bool { lock.withLock { request != nil } }
    func hold(_ value: AlertProtocol) { lock.withLock { request = value } }
    private func take() -> AlertProtocol? { lock.withLock { let old = request; request = nil; return old } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func releaseFixture() { take()?.fixture() }
}
private final class AlertProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (AlertProtocol) -> Void)?
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
        if request.url?.path == "/api/mobile/session" && request.httpMethod != "DELETE" { respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if request.httpMethod == "POST" { respond(201, #"{"id":1}"#) }
        else if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#) }
        else { respond(200, #"{"alerts":[]}"#) }
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
