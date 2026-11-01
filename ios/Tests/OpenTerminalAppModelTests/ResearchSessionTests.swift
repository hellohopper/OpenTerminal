import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct ResearchSessionTests {
    private func fixture() async -> (TerminalModel, ResearchModel) {
        CleanupProtocol.handler = { $0.fixture() }
        let terminal = TerminalModel(defaults: CleanupDefaults(suiteName: "cleanup-memory-\(UUID())")!, credentials: CleanupCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CleanupProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        terminal.serverText = "https://first.example.com"; await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL")
        research.range = "1Y"; research.noteSearch = "private search"; await research.searchNotes(); await research.refresh()
        research.title = "Private title"; research.bodyText = "Private body"
        return (terminal, research)
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        try #require(predicate(), "Expected research request did not arrive")
    }
    private func expectCleared(_ research: ResearchModel) {
        #expect(research.quote == nil && research.candles.isEmpty && research.news.isEmpty && research.notes.isEmpty)
        #expect(research.noteSearch.isEmpty && research.notesQuery.isEmpty && research.nextNoteCursor == nil && research.range == "6M")
        #expect(research.title.isEmpty && research.bodyText.isEmpty && !research.hasDraft && !research.saving && research.noteRevision == 0)
        #expect(research.message == nil && research.saveError == nil && research.noteDeleteErrors.isEmpty && research.deletingNoteIDs.isEmpty)
        #expect(research.errors.isEmpty && research.updated.isEmpty && research.loading.isEmpty && !research.loadingMoreNotes && research.notePageError == nil && research.noteSearchError == nil)
    }
    @Test func signOutClearsEveryLiveModelAndRetainedDraftBeforeLogoutReturns() async throws {
        let (terminal, research) = await fixture(); defer { CleanupProtocol.handler = nil }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL"), other = ResearchModel(terminal: terminal, symbol: "MSFT")
        await reopened.refresh(); other.title = "Other private draft"
        let state = try #require(terminal.researchNoteStates.values.first { $0.title == "Private title" })
        state.error = "Private save error"; state.message = "Private success"; state.deleteErrors = [9: "Private error"]; state.deletedIDs = [10]
        research.noteSearch = String(repeating: "x", count: 201); await research.searchNotes()
        #expect(research.quote != nil && !research.candles.isEmpty && !research.news.isEmpty && !research.notes.isEmpty && research.updated.count == 4 && research.noteSearchError != nil)
        let logout = CleanupGate(); CleanupProtocol.handler = { logout.hold($0) }
        let task = Task { await terminal.signOut() }; try await eventually { logout.waiting }
        expectCleared(research); expectCleared(reopened); expectCleared(other)
        #expect(terminal.researchDrafts.isEmpty && terminal.researchNoteStates.isEmpty)
        #expect(state.title.isEmpty && state.body.isEmpty && state.error == nil && state.message == nil && state.deleteErrors.isEmpty && state.deletedIDs.isEmpty)
        logout.release(); await task.value
    }
    @Test(arguments: [ResearchSection.quote, .chart, .news, .notes], [200, 401, 503]) func lateReadCannotRepopulateClearedDataOrAffectNewLogin(section: ResearchSection, status: Int) async throws {
        let (terminal, research) = await fixture(); defer { CleanupProtocol.handler = nil }
        let old = CleanupGate(), logout = CleanupGate(), latest = CleanupGate()
        CleanupProtocol.handler = { old.hold($0) }
        let first = Task { await research.load(section) }; try await eventually { old.waiting }
        CleanupProtocol.handler = { logout.hold($0) }
        let signOut = Task { await terminal.signOut() }; try await eventually { logout.waiting }
        expectCleared(research)
        CleanupProtocol.handler = { $0.fixture() }
        terminal.serverText = "https://second.example.com"; await terminal.restoreSession(force: true)
        let current = ResearchModel(terminal: terminal, symbol: "AAPL"); current.title = "New draft"
        CleanupProtocol.handler = { latest.hold($0) }
        let next = Task { await current.load(section) }; try await eventually { latest.waiting }
        old.release(status: status); await first.value
        expectCleared(research)
        #expect(terminal.signedIn && terminal.error == nil && current.loading.contains(section) && current.title == "New draft")
        logout.release(); await signOut.value
        latest.release(); await next.value
        #expect(current.updated[section] != nil && current.title == "New draft" && terminal.server?.origin.host == "second.example.com")
    }
    @Test(arguments: [false, true], [200, 401]) func pendingWritesClearImmediatelyAndCannotAlterTheNewDraft(deleting: Bool, status: Int) async throws {
        let (terminal, research) = await fixture(); defer { CleanupProtocol.handler = nil }
        let note = try #require(research.notes.first), write = CleanupGate(), logout = CleanupGate()
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL")
        CleanupProtocol.handler = { write.hold($0) }
        let first = Task { if deleting { await research.deleteNote(note) } else { await research.saveNote() } }
        try await eventually { write.waiting }
        #expect(deleting ? reopened.deletingNoteIDs == [note.id] : reopened.saving)
        CleanupProtocol.handler = { logout.hold($0) }
        let signOut = Task { await terminal.signOut() }; try await eventually { logout.waiting }
        expectCleared(research); expectCleared(reopened)
        CleanupProtocol.handler = { $0.fixture() }; await terminal.restoreSession(force: true)
        let current = ResearchModel(terminal: terminal, symbol: "AAPL"); current.title = "Fresh title"; current.bodyText = "Fresh body"
        write.release(status: status); await first.value
        expectCleared(research); expectCleared(reopened)
        #expect(terminal.signedIn && terminal.error == nil && current.title == "Fresh title" && current.bodyText == "Fresh body" && current.message == nil && current.saveError == nil)
        logout.release(); await signOut.value
    }
    @Test(arguments: [ResearchSection.quote, .chart, .news, .notes]) func currentUnauthorizedReadClearsEveryResearchView(section: ResearchSection) async {
        let (terminal, research) = await fixture(); defer { CleanupProtocol.handler = nil }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL"); await reopened.refresh()
        CleanupProtocol.handler = { request in
            if request.request.httpMethod == "DELETE" { request.fixture() } else { request.respond(401, "") }
        }
        await research.load(section)
        #expect(!terminal.signedIn && terminal.error != nil)
        expectCleared(research); expectCleared(reopened)
    }
    @Test(arguments: [false, true]) func staleBindingsAndActionsCannotRecreateStateAfterReconnecting(changeServer: Bool) async throws {
        let (terminal, research) = await fixture(); defer { CleanupProtocol.handler = nil }
        await terminal.signOut()
        if changeServer { terminal.serverText = "https://second.example.com" }
        await terminal.restoreSession(force: true)
        let current = ResearchModel(terminal: terminal, symbol: "AAPL"); current.title = "Current title"; current.bodyText = "Current body"; current.range = "5Y"
        let requests = CleanupRequests(); CleanupProtocol.handler = { request in requests.append(request); request.fixture() }
        research.title = "Old binding"; research.bodyText = "Old body"; research.noteSearch = String(repeating: "x", count: 201); research.range = "1M"
        research.discardDraft(); await research.searchNotes(); await research.clearNotesSearch(); await research.refresh(); await research.loadMoreNotes(); await research.saveNote()
        expectCleared(research)
        #expect(requests.count == 0 && current.title == "Current title" && current.bodyText == "Current body" && terminal.preferredChartRange == "5Y")
        #expect(terminal.researchNoteStates.count == 1 && terminal.researchDrafts.count == 1)
    }
    @Test func failedAndPendingOlderPagesClearWithTheSession() async throws {
        let (terminal, research) = await fixture(); defer { CleanupProtocol.handler = nil }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL"); await reopened.load(.notes)
        CleanupProtocol.handler = { $0.respond(503, #"{"error":"Private provider diagnostic"}"#) }
        await research.loadMoreNotes(); await research.load(.quote)
        #expect(research.notePageError != nil && research.errors[.quote] != nil)
        let page = CleanupGate(), logout = CleanupGate()
        CleanupProtocol.handler = { page.hold($0) }
        let more = Task { await reopened.loadMoreNotes() }; try await eventually { page.waiting }
        #expect(reopened.loadingMoreNotes)
        CleanupProtocol.handler = { logout.hold($0) }
        let signOut = Task { await terminal.signOut() }; try await eventually { logout.waiting }
        expectCleared(research); expectCleared(reopened)
        page.release(status: 401); await more.value
        expectCleared(reopened); #expect(terminal.error == nil)
        logout.release(); await signOut.value
    }
    @Test func signedOutConstructionCannotRegisterDraftsOrStartReads() async {
        let (terminal, _) = await fixture(); defer { CleanupProtocol.handler = nil }; await terminal.signOut()
        let requests = CleanupRequests(); CleanupProtocol.handler = { request in requests.append(request); request.fixture() }
        let research = ResearchModel(terminal: terminal, symbol: "AAPL")
        research.title = "Stale input"; research.bodyText = "Private"; research.noteSearch = "Query"
        await research.searchNotes(); await research.refresh(); await research.saveNote()
        expectCleared(research)
        #expect(requests.count == 0 && terminal.researchDrafts.isEmpty && terminal.researchNoteStates.isEmpty)
    }
    @Test func canceledReadsAndSearchDoNotStartRequestsOrReplaceTheCurrentSearch() async {
        let (_, research) = await fixture(); defer { CleanupProtocol.handler = nil }
        let before = research.notes, time = research.updated[.notes], requests = CleanupRequests()
        CleanupProtocol.handler = { request in requests.append(request); request.fixture() }
        research.noteSearch = "Queued search"
        let task = Task { await research.searchNotes(); await research.refresh() }; task.cancel(); await task.value
        #expect(requests.count == 0 && research.notes == before && research.updated[.notes] == time && research.notesQuery == "private search" && research.loading.isEmpty)
    }
}

@MainActor private final class CleanupCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "cleanup-test-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class CleanupDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
}
private final class CleanupRequests: @unchecked Sendable {
    private let lock = NSLock(); private var requests: [URLRequest] = []
    func append(_ value: CleanupProtocol) { lock.withLock { requests.append(value.request) } }
    var count: Int { lock.withLock { requests.count } }
}
private final class CleanupGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: CleanupProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: CleanupProtocol) { lock.withLock { held = value } }
    func release(status: Int = 200) {
        let value = lock.withLock { let value = held; held = nil; return value }
        if status == 200 { value?.fixture() } else { value?.respond(status, #"{"error":"Old request failed"}"#) }
    }
}
private final class CleanupProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (CleanupProtocol) -> Void)?
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
        if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#); return }
        switch request.url?.path {
        case "/api/mobile/session": respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#)
        case "/api/quotes": respond(200, #"[{"symbol":"AAPL","price":123,"currency":"USD","source":"private provider"}]"#)
        case "/api/history/AAPL": respond(200, #"[{"time":1720000000,"close":123}]"#)
        case "/api/news": respond(200, #"[{"title":"Private headline","publisher":"Private publisher","link":"https://example.com/news"}]"#)
        case "/api/journal":
            if request.httpMethod == "POST" { respond(201, #"{"id":2}"#) }
            else {
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
                let data = try! JSONSerialization.data(withJSONObject: ["entries": [["id": 1, "symbol": "AAPL", "title": "Private note", "body": "Private evidence", "version": "v1"]], "nextCursor": 1, "query": query])
                respond(200, String(decoding: data, as: UTF8.self))
            }
        default: respond(404, #"{"error":"Unexpected research cleanup fixture"}"#)
        }
    }
}
