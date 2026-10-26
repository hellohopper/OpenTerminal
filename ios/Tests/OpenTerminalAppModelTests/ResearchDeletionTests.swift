import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct ResearchDeletionTests {
    private func fixture() async throws -> (TerminalModel, ResearchModel, NoteRequests) {
        let requests = NoteRequests()
        NoteProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let terminal = TerminalModel(defaults: NoteDefaults(suiteName: "notes-memory-\(UUID())")!, credentials: NoteCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [NoteProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        terminal.serverText = "https://first.example.com"; await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL")
        research.noteSearch = "cash"; await research.searchNotes()
        research.title = "Keep my draft"; research.bodyText = "New evidence"
        requests.clear(); return (terminal, research, requests)
    }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(condition(), "Expected note request did not start")
    }

    @Test func reopenedViewsShareThePendingDeleteAndConfirmedRemovalWithoutLosingDrafts() async throws {
        let (terminal, research, requests) = try await fixture(); defer { NoteProtocol.handler = nil }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL"); await reopened.load(.notes)
        let note = try #require(research.notes.first), gate = NoteGate(); requests.clear()
        NoteProtocol.handler = { request in requests.append(request.request); gate.hold(request) }
        let deletion = Task { await research.deleteNote(note) }; try await eventually { gate.waiting }
        #expect(research.deletingNoteIDs == [note.id] && reopened.deletingNoteIDs == [note.id])
        await reopened.deleteNote(note)
        #expect(requests.all.count == 1 && requests.all.first?.httpMethod == "DELETE")
        let query = URLComponents(url: try #require(requests.all.first?.url), resolvingAgainstBaseURL: false)?.queryItems
        #expect(query == [URLQueryItem(name: "version", value: "v1")])
        gate.release(204, ""); await deletion.value
        #expect(research.deletingNoteIDs.isEmpty && reopened.deletingNoteIDs.isEmpty)
        #expect(research.notes.map(\.id) == [2] && reopened.notes.map(\.id) == [2])
        #expect(research.notesQuery == "cash" && research.nextNoteCursor == 2)
        #expect(reopened.title == "Keep my draft" && research.bodyText == "New evidence")
        #expect(requests.all.count == 1) // Confirmed deletion needs no market or list refresh.
        NoteProtocol.handler = { $0.fixture() }
        let later = ResearchModel(terminal: terminal, symbol: "AAPL"); await later.load(.notes)
        #expect(later.notes.map(\.id) == [2])
    }

    @Test func delayedFirstPageCannotResurrectADeletedNote() async throws {
        let (_, research, _) = try await fixture(); defer { NoteProtocol.handler = nil }
        let row = try #require(research.notes.first), gate = NoteGate()
        NoteProtocol.handler = { request in
            if request.request.httpMethod == "DELETE" { request.respond(204, "") } else { gate.hold(request) }
        }
        let refresh = Task { await research.load(.notes) }; try await eventually { gate.waiting }
        await research.deleteNote(row)
        gate.releasePage(ids: [3, 2], cursor: 2); await refresh.value
        #expect(research.notes.map(\.id) == [2] && research.nextNoteCursor == 2 && research.notesQuery == "cash")
    }

    @Test func deletionInAnotherViewFiltersAnOlderPageWhileKeepingItsCursor() async throws {
        let (terminal, research, _) = try await fixture(); defer { NoteProtocol.handler = nil }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL"); await reopened.load(.notes)
        NoteProtocol.handler = { $0.page(ids: [1]) }; await reopened.loadMoreNotes()
        let row = try #require(reopened.notes.first { $0.id == 1 }), gate = NoteGate()
        NoteProtocol.handler = { request in
            if request.request.httpMethod == "DELETE" { request.respond(204, "") } else { gate.hold(request) }
        }
        let more = Task { await research.loadMoreNotes() }; try await eventually { gate.waiting }
        await reopened.deleteNote(row)
        gate.releasePage(ids: [1]); await more.value
        #expect(research.notes.map(\.id) == [3, 2] && reopened.notes.map(\.id) == [3, 2])
        #expect(research.nextNoteCursor == nil && !research.loadingMoreNotes && research.notePageError == nil)
    }

    @Test func failedDeletionPreservesTheNoteAndDraftAndCanBeRetried() async throws {
        let (terminal, research, requests) = try await fixture(); defer { NoteProtocol.handler = nil }
        let row = try #require(research.notes.first)
        NoteProtocol.handler = { request in requests.append(request.request); request.respond(503, #"{"error":"Try later"}"#) }
        await research.deleteNote(row)
        #expect(research.notes.contains(row) && research.noteDeleteErrors[row.id] != nil && research.deletingNoteIDs.isEmpty)
        #expect(research.hasDraft && research.title == "Keep my draft" && terminal.signedIn && terminal.error == nil)
        NoteProtocol.handler = { request in requests.append(request.request); request.respond(204, "") }
        await research.deleteNote(row)
        #expect(!research.notes.contains(row) && research.noteDeleteErrors[row.id] == nil && requests.all.count == 2)
    }

    @Test func conflictRequiresReviewAndUsesTheReviewedVersion() async throws {
        let (_, research, requests) = try await fixture(); defer { NoteProtocol.handler = nil }
        let old = try #require(research.notes.first)
        NoteProtocol.handler = { request in requests.append(request.request); request.respond(409, #"{"error":"This entry changed on another device. Refresh research notes and review it before deleting."}"#) }
        await research.deleteNote(old)
        #expect(research.notes.contains(old) && research.noteDeleteErrors[old.id] != nil && requests.all.count == 1)
        NoteProtocol.handler = { $0.page(ids: [3, 2], cursor: 2, version: "v2") }; await research.load(.notes)
        let current = try #require(research.notes.first)
        await research.deleteNote(old)
        #expect(requests.all.count == 1 && research.notes.contains(current))
        NoteProtocol.handler = { request in requests.append(request.request); request.respond(204, "") }
        await research.deleteNote(current)
        #expect(!research.notes.contains(current) && research.noteDeleteErrors[current.id] == nil)
        #expect(requests.all.last?.url?.query == "version=v2")
    }

    @Test(arguments: [204, 401]) func oldDeletionCannotAffectANewerSessionWithTheSameNoteID(status: Int) async throws {
        let (terminal, research, _) = try await fixture(); defer { NoteProtocol.handler = nil }
        let row = try #require(research.notes.first), old = NoteGate(), logout = NoteGate(), latest = NoteGate()
        NoteProtocol.handler = { request in
            if request.request.url?.host == "first.example.com" {
                if request.request.url?.path == "/api/journal/3" { old.hold(request) }
                else if request.request.httpMethod == "DELETE" { logout.hold(request) }
                else { request.fixture() }
            } else if request.request.url?.path == "/api/journal/3" { latest.hold(request) }
            else { request.fixture() }
        }
        let deletion = Task { await research.deleteNote(row) }; try await eventually { old.waiting }
        let signOut = Task { await terminal.signOut() }; try await eventually { logout.waiting }
        terminal.serverText = "https://second.example.com"; await terminal.restoreSession(force: true)
        let current = ResearchModel(terminal: terminal, symbol: "AAPL"); await current.load(.notes)
        current.title = "New server draft"
        await research.deleteNote(row); #expect(!latest.waiting)
        let next = Task { await current.deleteNote(row) }; try await eventually { latest.waiting }
        old.release(status, ""); await deletion.value
        #expect(terminal.signedIn && terminal.error == nil && terminal.server?.origin.host == "second.example.com")
        #expect(current.notes.contains(row) && current.deletingNoteIDs == [row.id] && current.noteDeleteErrors.isEmpty)
        #expect(current.title == "New server draft")
        logout.release(200, #"{"ok":true}"#); await signOut.value
        latest.release(204, ""); await next.value
        #expect(current.deletingNoteIDs.isEmpty && !current.notes.contains(row))
    }

    @Test func currentUnauthorizedDeletionRequiresSignIn() async throws {
        let (terminal, research, _) = try await fixture(); defer { NoteProtocol.handler = nil }
        let row = try #require(research.notes.first)
        NoteProtocol.handler = { request in
            if request.request.url?.path == "/api/journal/3" { request.respond(401, "") } else { request.fixture() }
        }
        await research.deleteNote(row)
        #expect(!terminal.signedIn && terminal.error != nil && terminal.researchNoteStates.isEmpty && research.deletingNoteIDs.isEmpty)
    }

    @Test func missingVersionsAndForeignOrStaleControlsNeverDelete() async throws {
        let (terminal, research, requests) = try await fixture(); defer { NoteProtocol.handler = nil }
        NoteProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let foreign = ResearchModel(terminal: terminal, symbol: "MSFT"), row = try #require(research.notes.first)
        foreign.notes = [row]; await foreign.deleteNote(row)
        let legacy = try JSONDecoder().decode(JournalEntry.self, from: Data(#"{"id":3,"symbol":"AAPL","title":"Legacy","body":"Old backend"}"#.utf8))
        research.notes = [legacy]; await research.deleteNote(legacy)
        #expect(research.noteDeleteErrors[3]?.contains("Update the Mac") == true)
        research.notes = []; await research.deleteNote(row)
        #expect(requests.all.isEmpty)
    }

    @Test func cancelingADeleteClearsSharedProgressWithoutAutomaticRetry() async throws {
        let (terminal, research, requests) = try await fixture(); defer { NoteProtocol.handler = nil }
        let row = try #require(research.notes.first), gate = NoteGate()
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL")
        NoteProtocol.handler = { request in requests.append(request.request); gate.hold(request) }
        let deletion = Task { await research.deleteNote(row) }; try await eventually { gate.waiting }
        deletion.cancel(); await deletion.value
        #expect(research.notes.contains(row) && reopened.deletingNoteIDs.isEmpty && research.noteDeleteErrors.isEmpty)
        #expect(requests.all.count == 1)
        gate.release(204, "")
    }

    @Test func confirmedDeletionsAreForgottenAtTheNextLogin() async throws {
        let (terminal, research, _) = try await fixture(); defer { NoteProtocol.handler = nil }
        let row = try #require(research.notes.first); await research.deleteNote(row)
        let sameSession = ResearchModel(terminal: terminal, symbol: "AAPL"); await sameSession.load(.notes)
        #expect(!sameSession.notes.contains(row))
        await terminal.signOut(); await terminal.restoreSession(force: true)
        let fresh = ResearchModel(terminal: terminal, symbol: "AAPL"); await fresh.load(.notes)
        #expect(fresh.notes.contains(row) && !fresh.hasDraft && fresh.deletingNoteIDs.isEmpty)
    }
}

@MainActor private final class NoteCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-note-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class NoteDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
}
private final class NoteRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { values } }
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func clear() { lock.withLock { values = [] } }
}
private final class NoteGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: NoteProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: NoteProtocol) { lock.withLock { held = value } }
    private func take() -> NoteProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func releasePage(ids: [Int], cursor: Int? = nil) { take()?.page(ids: ids, cursor: cursor) }
}
private final class NoteProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (NoteProtocol) -> Void)?
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
        else if request.httpMethod == "DELETE" { respond(204, "") }
        else if request.url?.path == "/api/journal" { page(ids: [3, 2], cursor: 2) }
        else { respond(404, #"{"error":"Unexpected note fixture"}"#) }
    }
    func page(ids: [Int], cursor: Int? = nil, version: String = "v1") {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
        let data = try! JSONSerialization.data(withJSONObject: ["entries": ids.map { ["id": $0, "symbol": "AAPL", "title": "Note \($0)", "body": "Evidence", "version": version] }, "nextCursor": cursor as Any? ?? NSNull(), "query": query])
        respond(200, String(decoding: data, as: UTF8.self))
    }
}
