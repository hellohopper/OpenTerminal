import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct ResearchInboxTests {
    private func terminal(_ store: ResearchCaptureStore) async -> TerminalModel {
        let value = TerminalModel(defaults: CaptureDefaults(suiteName: UUID().uuidString)!, credentials: CaptureCredentials(), researchFiles: store) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CaptureProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        value.serverText = "https://first.example.com"; await value.restoreSession(); return value
    }
    @Test func offlineCaptureRetriesTheSameItemAndRemovesItOnlyAfterAcknowledgement() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); CaptureProtocol.upload = nil }
        let store = ResearchCaptureStore(root: root), model = await terminal(store)
        #expect(model.signedIn)
        #expect(model.researchInbox.collect(title: "Remember this", text: "A thought", url: "https://example.com"))
        let original = try #require(store.captures().first)
        CaptureProtocol.upload = { request in request.failOffline() }
        await model.researchInbox.refreshAndUpload()
        #expect(try store.captures().first?.id == original.id)
        #expect(model.researchInbox.error != nil)
        CaptureProtocol.upload = { request in request.respond(201, "{\"id\":1}") }
        await model.researchInbox.refreshAndUpload()
        #expect(try store.captures().isEmpty)
        #expect(model.researchInbox.captures.isEmpty)
    }
    @Test func unassignedAndForeignServerCapturesAreNeverAutomaticallyUploaded() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); CaptureProtocol.upload = nil }
        let store = ResearchCaptureStore(root: root)
        let shared = ResearchCapture(title: "Unassigned"), foreign = ResearchCapture(title: "Other server", origin: "https://second.example.com")
        try store.save(shared); try store.save(foreign)
        let model = await terminal(store), calls = CaptureCounter()
        CaptureProtocol.upload = { request in calls.add(); request.respond(201, "{\"id\":1}") }
        await model.researchInbox.refreshAndUpload()
        #expect(calls.value == 0 && model.researchInbox.captures.map(\.id) == [shared.id])
        await model.researchInbox.upload(shared)
        #expect(calls.value == 1)
        #expect(try store.captures().map(\.id) == [foreign.id])
    }
    @Test func aLateUploadCannotChangeASignedOutSession() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root); CaptureProtocol.upload = nil }
        let store = ResearchCaptureStore(root: root), model = await terminal(store), gate = CaptureGate()
        #expect(model.researchInbox.collect(title: "Queued", text: "", url: ""))
        CaptureProtocol.upload = { request in gate.hold(request) }
        let pending = Task { await model.researchInbox.refreshAndUpload() }
        for _ in 0..<200 { if gate.waiting { break }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(gate.waiting)
        await model.signOut(); gate.release(); await pending.value
        #expect(model.researchInbox.captures.isEmpty && model.researchInbox.message == nil)
        #expect(try store.captures().isEmpty)
    }
    @Test func researchDraftsRestoreAfterRestartAndClearOnSignOut() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ResearchCaptureStore(root: root), first = await terminal(store)
        let editor = ResearchModel(terminal: first, symbol: "AAPL"); editor.title = "Persistent draft"; editor.bodyText = "Evidence"
        let second = await terminal(ResearchCaptureStore(root: root)), restored = ResearchModel(terminal: second, symbol: "AAPL")
        #expect(restored.title == "Persistent draft" && restored.bodyText == "Evidence")
        #expect(ResearchModel(terminal: second, symbol: "MSFT").title.isEmpty)
        await second.signOut()
        #expect(try store.draft(origin: "https://first.example.com", symbol: "AAPL") == nil)
        #expect(restored.title.isEmpty)
    }
}
@MainActor private final class CaptureCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-capture-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class CaptureDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
}
private final class CaptureCounter: @unchecked Sendable {
    private let lock = NSLock(); private var count = 0
    var value: Int { lock.withLock { count } }
    func add() { lock.withLock { count += 1 } }
}
private final class CaptureGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: CaptureProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ request: CaptureProtocol) { lock.withLock { held = request } }
    func release() { let request = lock.withLock { let value = held; held = nil; return value }; request?.respond(201, "{\"id\":1}") }
}
private final class CaptureProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var upload: (@Sendable (CaptureProtocol) -> Void)?
    private let lock = NSLock(); private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.path == "/api/research-inbox" { Self.upload?(self) }
        else if request.httpMethod == "DELETE" { respond(204, "") }
        else { respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
    }
    override func stopLoading() { lock.withLock { stopped = true } }
    func failOffline() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    func respond(_ status: Int, _ body: String) {
        guard !lock.withLock({ stopped }) else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
}
