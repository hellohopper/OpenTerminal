import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct ResearchSaveTests {
    private func fixture() async throws -> (TerminalModel, ResearchModel, SaveRequests) {
        let requests = SaveRequests()
        SaveProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let terminal = TerminalModel(defaults: SaveDefaults(suiteName: "save-memory-\(UUID())")!, credentials: SaveCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SaveProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        terminal.serverText = "https://first.example.com"; await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL")
        populate(research); requests.clear(); return (terminal, research, requests)
    }
    private func populate(_ research: ResearchModel) { research.title = " Original "; research.bodyText = "Evidence\nSecond line" }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(condition(), "Expected save or refresh did not complete")
    }

    @Test func acknowledgedSaveEndsBeforeAStalledListRefresh() async throws {
        let (terminal, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        let list = SaveGate()
        SaveProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { list.hold(request) } else { request.fixture() }
        }
        await research.saveNote()
        #expect(!research.saving && !research.hasDraft && research.noteRevision == 1 && research.message == "Note saved.")
        #expect(terminal.researchDrafts.isEmpty)
        try await eventually { list.waiting }
        #expect(requests.all.count == 2 && requests.all.allSatisfy { $0.url?.path == "/api/journal" })
        let post = try #require(requests.all.first { $0.httpMethod == "POST" })
        let body = try #require(SaveProtocol.body(post))
        #expect(body["title"] as? String == "Original" && body["body"] as? String == "Evidence\nSecond line")
        #expect(body["symbol"] as? String == "AAPL" && body["kind"] as? String == "research")
        list.releaseFixture(); try await eventually { research.updated[.notes] != nil }
    }

    @Test(arguments: [false, true], [false, true]) func newerEditsSurviveEvenWhenTheyReturnToTheSubmittedText(editTitle: Bool, returnToOriginal: Bool) async throws {
        let (terminal, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        let post = SaveGate()
        SaveProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { post.hold(request) } else { request.fixture() }
        }
        let save = Task { await research.saveNote() }; try await eventually { post.waiting }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL")
        if editTitle { reopened.title = "Edited title"; if returnToOriginal { reopened.title = " Original " } }
        else { reopened.bodyText = "Edited evidence"; if returnToOriginal { reopened.bodyText = "Evidence\nSecond line" } }
        reopened.discardDraft(); await reopened.saveNote()
        #expect(reopened.hasDraft && reopened.saving && requests.all.count == 1)
        post.releaseFixture(); await save.value
        #expect(reopened.hasDraft && !reopened.saving && research.noteRevision == 1)
        #expect(reopened.message == "Note saved. Newer edits are kept as a draft.")
        #expect(editTitle ? reopened.title == (returnToOriginal ? " Original " : "Edited title") : reopened.bodyText == (returnToOriginal ? "Evidence\nSecond line" : "Edited evidence"))
        try await eventually { research.updated[.notes] != nil && reopened.updated[.notes] != nil }
        #expect(requests.all.filter { $0.httpMethod == "POST" }.count == 1 && requests.all.filter { $0.httpMethod == "GET" }.count == 2)
    }

    @Test func eachReopenedModelRefreshesItsOwnActiveSearchOnce() async throws {
        let (terminal, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        research.noteSearch = "cash"; await research.searchNotes()
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL")
        reopened.noteSearch = "growth"; await reopened.searchNotes(); requests.clear()
        SaveProtocol.handler = { request in requests.append(request.request); request.fixture() }
        await research.saveNote()
        try await eventually { research.updated[.notes] != nil && reopened.updated[.notes] != nil }
        let queries = requests.all.filter { $0.httpMethod == "GET" }.map { request in
            URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
        }
        #expect(queries.sorted() == ["cash", "growth"] && requests.all.count == 3)
        #expect(!research.hasDraft && !reopened.hasDraft && research.notesQuery == "cash" && reopened.notesQuery == "growth")
    }

    @Test(arguments: [200, 401]) func aPreSaveSnapshotCannotReplaceTheConfirmedRefreshOrSignOutTheSession(status: Int) async throws {
        let (terminal, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        let old = SaveGate(), latest = SaveGate()
        SaveProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" {
                if requests.all.filter({ $0.httpMethod == "GET" }).count == 1 { old.hold(request) } else { latest.hold(request) }
            } else { request.fixture() }
        }
        let refresh = Task { await research.load(.notes) }; try await eventually { old.waiting }
        await research.saveNote(); try await eventually { latest.waiting }
        old.release(status, #"{"entries":[{"id":99,"symbol":"AAPL","title":"Old","body":"Snapshot"}]}"#); await refresh.value
        #expect(terminal.signedIn && research.notes.isEmpty && research.errors[.notes] == nil && research.loading.contains(.notes))
        #expect(!research.saving && research.message == "Note saved.")
        latest.releaseFixture(); try await eventually { research.updated[.notes] != nil }
        #expect(research.notes.map(\.id) == [1])
    }

    @Test func listFailureDoesNotMakeAnAcknowledgedWriteFail() async throws {
        let (_, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        SaveProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { request.respond(503, #"{"error":"List unavailable"}"#) } else { request.fixture() }
        }
        await research.saveNote(); try await eventually { research.errors[.notes] != nil }
        #expect(!research.hasDraft && !research.saving && research.saveError == nil && research.noteRevision == 1)
        #expect(research.message == "Note saved.")
    }

    @Test func editingAfterAFailedWriteClearsTheErrorAndRetryPreservesTheDraft() async throws {
        let (_, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        SaveProtocol.handler = { request in requests.append(request.request); request.respond(503, #"{"error":"Retry later"}"#) }
        await research.saveNote()
        #expect(research.hasDraft && !research.saving && research.saveError != nil && research.noteRevision == 0 && requests.all.count == 1)
        research.bodyText = "Revised evidence"; #expect(research.saveError == nil)
        SaveProtocol.handler = { request in requests.append(request.request); request.fixture() }
        await research.saveNote(); try await eventually { research.updated[.notes] != nil }
        #expect(!research.hasDraft && research.saveError == nil && research.noteRevision == 1)
        research.title = "Next note"; #expect(research.message == nil)
    }

    @Test(arguments: [201, 401]) func oldSaveCannotAlterTheNewConnectionOrItsPendingSave(status: Int) async throws {
        let (terminal, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        let old = SaveGate(), logout = SaveGate(), latest = SaveGate()
        SaveProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "POST" { old.hold(request) }
                else if request.request.httpMethod == "DELETE" { logout.hold(request) }
                else { request.fixture() }
            } else if request.request.httpMethod == "POST" { latest.hold(request) }
            else { request.fixture() }
        }
        let save = Task { await research.saveNote() }; try await eventually { old.waiting }
        let signOut = Task { await terminal.signOut() }; try await eventually { logout.waiting }
        terminal.serverText = "https://second.example.com"; await terminal.restoreSession(force: true)
        let current = ResearchModel(terminal: terminal, symbol: "AAPL"); current.title = "New session"; current.bodyText = "New evidence"
        await research.saveNote(); #expect(!latest.waiting)
        let next = Task { await current.saveNote() }; try await eventually { latest.waiting }
        old.release(status, #"{"id":1}"#); await save.value
        #expect(terminal.signedIn && terminal.error == nil && terminal.server?.origin.host == "second.example.com")
        #expect(current.saving && current.title == "New session" && current.noteRevision == 0 && current.saveError == nil)
        #expect(research.noteRevision == 0 && research.message == nil && research.saveError == nil)
        #expect(!requests.all.contains { $0.url?.host == "first.example.com" && $0.url?.path == "/api/journal" && $0.httpMethod == "GET" })
        logout.releaseFixture(); await signOut.value
        latest.releaseFixture(); await next.value
        try await eventually { current.updated[.notes] != nil }
        #expect(!current.saving && !current.hasDraft && current.noteRevision == 1)
    }

    @Test func currentUnauthorizedWriteRequiresSignIn() async throws {
        let (terminal, research, _) = try await fixture(); defer { SaveProtocol.handler = nil }
        SaveProtocol.handler = { request in
            if request.request.url?.path == "/api/journal" { request.respond(401, "") } else { request.fixture() }
        }
        await research.saveNote()
        #expect(!terminal.signedIn && terminal.error != nil && !research.saving && terminal.researchNoteStates.isEmpty)
    }

    @Test func canceledSaveDoesNotRetryOrDiscardItsDraft() async throws {
        let (_, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        let canceled = Task { await Task.yield(); await research.saveNote() }; canceled.cancel(); await canceled.value
        #expect(requests.all.isEmpty && research.hasDraft && !research.saving)
        let post = SaveGate()
        SaveProtocol.handler = { request in requests.append(request.request); post.hold(request) }
        let save = Task { await research.saveNote() }; try await eventually { post.waiting }
        save.cancel(); await save.value
        #expect(requests.all.count == 1 && research.hasDraft && !research.saving && research.saveError == nil && research.noteRevision == 0)
        post.releaseFixture()
        SaveProtocol.handler = { request in requests.append(request.request); request.fixture() }
        await research.saveNote(); try await eventually { research.updated[.notes] != nil }
        #expect(!research.hasDraft && research.noteRevision == 1)
    }

    @Test func invalidDraftsAreKeptWithoutSendingARequest() async throws {
        let (_, research, requests) = try await fixture(); defer { SaveProtocol.handler = nil }
        research.title = " \n "; await research.saveNote(); #expect(research.saveError != nil)
        research.title = String(repeating: "😀", count: 61); await research.saveNote(); #expect(research.saveError != nil)
        research.title = "Valid"; research.bodyText = String(repeating: "x", count: 20001)
        await research.saveNote()
        #expect(research.saveError != nil && research.hasDraft && !research.saving && requests.all.isEmpty)
    }
}

@MainActor private final class SaveCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-save-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class SaveDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
}
private final class SaveRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { values } }
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func clear() { lock.withLock { values = [] } }
}
private final class SaveGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: SaveProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: SaveProtocol) { lock.withLock { held = value } }
    private func take() -> SaveProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func releaseFixture() { take()?.fixture() }
}
private final class SaveProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (SaveProtocol) -> Void)?
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
        else {
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
            let data = try! JSONSerialization.data(withJSONObject: ["entries": [["id": 1, "symbol": "AAPL", "title": "Saved", "body": "Evidence"]], "query": query])
            respond(200, String(decoding: data, as: UTF8.self))
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
