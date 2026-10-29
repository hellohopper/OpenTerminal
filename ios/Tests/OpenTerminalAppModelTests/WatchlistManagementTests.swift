import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct WatchlistManagementTests {
    private func fixture() async throws -> (TerminalModel, ListsServer, ListsRequests) {
        let server = ListsServer(), requests = ListsRequests()
        ListsProtocol.handler = { requests.append($0.captured); server.handle($0) }
        let model = TerminalModel(defaults: ListsDefaults(suiteName: "lists-memory-\(UUID())")!, credentials: ListsCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ListsProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession(); try await model.refreshLists(); requests.clear()
        return (model, server, requests)
    }
    private func plan(_ model: TerminalModel, name: String = "Created", copy: Bool = false) throws -> WatchlistCreationPlan {
        try #require(model.prepareListCreation(name: name, copying: copy ? model.sharedLists.first { $0.id == model.sharedListID } : nil, session: model.sessionID, selection: model.listSelection))
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        try #require(predicate(), "Expected shared-list operation did not complete")
    }
    @Test func creationIsAcknowledgedBeforeListsOrMarketReadsFinish() async throws {
        let (model, server, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let draft = model.listNameDraft; draft.text = "Copy"
        let value = try plan(model, name: draft.text, copy: true), list = ListsGate(), quote = ListsGate(), briefing = ListsGate()
        ListsProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "GET" && request.request.url?.path == "/api/watchlists" { list.hold(request) }
            else if request.request.url?.path == "/api/quotes" { quote.hold(request) }
            else if request.request.url?.path == "/api/briefings/current" { briefing.hold(request) }
            else { server.handle(request) }
        }
        let saved = await model.submitListCreation(value, draft: draft, revision: draft.revision)
        try await eventually { list.waiting && quote.waiting && briefing.waiting }
        #expect(saved && !model.managingLists && !draft.creating && draft.text.isEmpty && model.sharedListID == 3)
        #expect(model.sharedLists.last?.payload.name == "Copy" && model.watchlist == ["AAPL", "MSFT"] && model.loadingSharedLists)
        #expect(model.listManagementError == nil && model.listManagementMessage == "Watchlist created." && requests.posts.count == 1)
        list.release(503, ""); quote.release(503, ""); briefing.release(using: server)
        try await eventually { !model.loadingSharedLists && model.sharedListReadError != nil && !model.loadingSections.contains(.watchlist) && !model.loadingSections.contains(.briefing) }
        #expect(model.listManagementError == nil && model.listManagementMessage == "Watchlist created.")
        await model.signOut()
    }
    @Test func retryAfterReadFailureDoesNotRepeatTheCreation() async throws {
        let (model, server, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        ListsProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "GET" && request.request.url?.path == "/api/watchlists" { request.respond(503, "") } else { server.handle(request) }
        }
        let saved = await model.createList(name: "Created")
        try await eventually { !model.loadingSharedLists && model.sharedListReadError != nil }
        #expect(saved && model.sharedLists.contains { $0.id == 3 } && requests.posts.count == 1 && model.listManagementError == nil)
        ListsProtocol.handler = { requests.append($0.captured); server.handle($0) }; await model.reloadSharedLists(session: model.sessionID)
        #expect(model.sharedListReadError == nil && requests.posts.count == 1 && model.sharedLists.count == 3)
        await model.signOut()
    }
    @Test(arguments: [false, true]) func newNameInputSurvivesAndAnAcknowledgedDraftCannotSubmitAgain(returnToOriginal: Bool) async throws {
        let (model, server, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let draft = model.listNameDraft, gate = ListsGate(); draft.text = "Original"
        let value = try plan(model, name: draft.text), revision = draft.revision
        ListsProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) }
        }
        let write = Task { await model.submitListCreation(value, draft: draft, revision: revision) }; try await eventually { gate.waiting }
        draft.text = "Newer"; if returnToOriginal { draft.text = "Original" }
        let duplicate = await model.submitListCreation(value, draft: draft, revision: revision)
        #expect(!duplicate && requests.posts.count == 1)
        gate.release(using: server); let saved = await write.value
        #expect(saved && draft.text == (returnToOriginal ? "Original" : "Newer") && !draft.creating)
        let replay = await model.submitListCreation(value, draft: draft, revision: revision)
        #expect(!replay && requests.posts.count == 1)
        await model.signOut()
    }
    @Test func aCopyPlanKeepsItsSourceWhenSelectionChangesBeforeTheTaskStarts() async throws {
        let (model, _, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let value = try plan(model, copy: true); model.chooseList(2)
        let saved = await model.createList(value)
        #expect(saved && model.sharedListID == 2 && model.watchlist == ["TSLA"])
        #expect(model.sharedLists.last?.payload.symbols == ["AAPL", "MSFT"])
        let request = try #require(requests.posts.first), body = try #require(ListsProtocol.body(request))
        #expect(body["symbols"] as? [String] == ["AAPL", "MSFT"] && body["name"] as? String == "Created")
        await model.signOut()
    }
    @Test(arguments: [false, true]) func selectionChangesDuringCreationAreNotOverriddenEvenAfterReturningToTheOriginal(back: Bool) async throws {
        let (model, server, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let value = try plan(model), gate = ListsGate()
        ListsProtocol.handler = { request in requests.append(request.captured); if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) } }
        let write = Task { await model.createList(value) }; try await eventually { gate.waiting }
        model.chooseList(2); if back { model.chooseList(1) }
        gate.release(using: server); let saved = await write.value
        #expect(saved && model.sharedListID == (back ? 1 : 2) && model.sharedLists.contains { $0.id == 3 })
        await model.signOut()
    }
    @Test(arguments: ["rename", "delete", "move", "symbols"]) func eachMutationUpdatesItsCacheBeforeTheFollowUpRead(kind: String) async throws {
        let (model, server, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let row = try #require(model.sharedLists.first), read = ListsGate()
        ListsProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "GET" && request.request.url?.path == "/api/watchlists" { read.hold(request) } else { server.handle(request) }
        }
        if kind == "rename" { let saved = await model.renameList(row, name: "Renamed"); #expect(saved && model.sharedLists.first?.payload.name == "Renamed") }
        else if kind == "delete" { let saved = await model.deleteList(row); #expect(saved && model.sharedLists.map(\.id) == [2] && model.sharedListID == 2 && model.watchlist == ["TSLA"]) }
        else if kind == "move" { await model.moveList(row, direction: "down"); #expect(model.sharedLists.map(\.id) == [2, 1]) }
        else { await model.moveSymbol("MSFT", direction: -1, in: row, session: model.sessionID); #expect(model.watchlist == ["MSFT", "AAPL"] && model.sharedLists.first?.version == 2) }
        try await eventually { read.waiting }
        #expect(!model.managingLists && model.listManagementError == nil && model.listManagementMessage != nil)
        read.release(503, ""); try await eventually { !model.loadingSharedLists && model.sharedListReadError != nil }
        #expect(model.listManagementError == nil && requests.writes.count == 1)
        await model.signOut()
    }
    @Test(arguments: [200, 401]) func aPreAcknowledgementReadCannotUndoTheMutationOrEndTheNewRead(status: Int) async throws {
        let (model, server, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let old = ListsGate(), latest = ListsGate(), row = try #require(model.sharedLists.first), oldBody = server.lists()
        ListsProtocol.handler = { request in requests.append(request.captured); if request.request.url?.path == "/api/watchlists" { old.hold(request) } else { server.handle(request) } }
        let first = Task { await model.reloadSharedLists(session: model.sessionID) }; try await eventually { old.waiting }
        ListsProtocol.handler = { request in requests.append(request.captured); if request.request.url?.path == "/api/watchlists" { latest.hold(request) } else { server.handle(request) } }
        let renamed = await model.renameList(row, name: "Renamed"); try await eventually { latest.waiting }
        old.release(status, status == 200 ? oldBody : ""); await first.value
        #expect(renamed && model.signedIn && model.loadingSharedLists && model.sharedListReadError == nil && model.sharedLists.first?.payload.name == "Renamed")
        latest.release(using: server); try await eventually { !model.loadingSharedLists }
        await model.signOut()
    }
    @Test(arguments: [200, 401, 503], [false, true]) func aNewerAcceptedReadWinsWithoutAnyLocalWrite(status: Int, root: Bool) async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let old = ListsGate(), oldBody = server.lists()
        ListsProtocol.handler = { request in if request.request.url?.path == "/api/watchlists" { old.hold(request) } else { server.handle(request) } }
        let first = Task { if root { await model.refresh(); return false }; return try await model.refreshLists() }; try await eventually { old.waiting }
        server.update(1, name: "Latest", version: 2); ListsProtocol.handler = { server.handle($0) }; await model.reloadSharedLists(session: model.sessionID)
        old.release(status, status == 200 ? oldBody : ""); let accepted = try await first.value
        #expect(!accepted && model.signedIn && model.sharedListReadError == nil && model.sharedLists.first?.payload.name == "Latest")
        await model.signOut()
    }
    @Test func aCreationObservedThenDeletedDuringTheWriteCannotBeResurrectedByItsAcknowledgement() async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let gate = ListsGate(), value = try plan(model)
        ListsProtocol.handler = { request in if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) } }
        let write = Task { await model.createList(value) }; try await eventually { gate.waiting }
        let reply = try #require(gate.commit(using: server))
        await model.reloadSharedLists(session: model.sessionID); #expect(model.sharedLists.contains { $0.id == 3 })
        server.remove(3); await model.reloadSharedLists(session: model.sessionID)
        gate.release(reply); let saved = await write.value
        #expect(saved && model.sharedLists.map(\.id) == [1, 2] && model.sharedListID == 1)
        await model.signOut()
    }
    @Test(arguments: [false, true]) func cancellationReleasesOnlyTheCancelledReadsProgress(newer: Bool) async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let old = ListsGate(), latest = ListsGate(), before = model.sharedLists, session = model.sessionID
        ListsProtocol.handler = { request in if request.request.url?.path == "/api/watchlists" { old.hold(request) } else { server.handle(request) } }
        let read = Task { await model.reloadSharedLists(session: session) }; try await eventually { old.waiting }
        var next: Task<Void, Never>?
        if newer {
            ListsProtocol.handler = { request in if request.request.url?.path == "/api/watchlists" { latest.hold(request) } else { server.handle(request) } }
            next = Task { await model.reloadSharedLists(session: session) }; try await eventually { latest.waiting }
        }
        read.cancel(); await read.value
        #expect(model.loadingSharedLists == newer && model.sharedListReadError == nil && model.sharedLists == before && model.signedIn)
        if let next { latest.release(using: server); await next.value }
        #expect(!model.loadingSharedLists)
        await model.signOut()
    }
    @Test func anOlderRenameReplyPreservesANewerVersionAlreadyObserved() async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let gate = ListsGate(), row = try #require(model.sharedLists.first)
        ListsProtocol.handler = { request in if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) } }
        let write = Task { await model.renameList(row, name: "Older") }; try await eventually { gate.waiting }
        let reply = try #require(gate.commit(using: server)); server.update(1, name: "Latest", version: 3)
        await model.reloadSharedLists(session: model.sessionID)
        gate.release(reply); let saved = await write.value
        #expect(saved && model.sharedLists.first?.payload.name == "Latest" && model.sharedLists.first?.version == 3)
        await model.signOut()
    }
    @Test func aDeleteAcknowledgementPreservesANewerRestoredRecord() async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let gate = ListsGate(), row = try #require(model.sharedLists.first)
        ListsProtocol.handler = { request in if request.request.url?.path == "/api/watchlists/1" { gate.hold(request) } else { server.handle(request) } }
        let write = Task { await model.deleteList(row) }; try await eventually { gate.waiting }
        let reply = try #require(gate.commit(using: server)); server.update(1, name: "Restored", version: 5)
        await model.reloadSharedLists(session: model.sessionID); gate.release(reply); let saved = await write.value
        #expect(saved && model.sharedLists.first { $0.id == 1 }?.version == 5 && model.sharedListID == 1)
        await model.signOut()
    }
    @Test(arguments: [false, true]) func orderRepliesPreserveNewerPayloadsNewListsAndConfirmedRemovals(removeFirst: Bool) async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let gate = ListsGate(), row = try #require(model.sharedLists.first)
        ListsProtocol.handler = { request in if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) } }
        let write = Task { await model.moveList(row, direction: "down") }; try await eventually { gate.waiting }
        let reply = try #require(gate.commit(using: server)); server.update(1, name: "Latest", version: 3); server.update(4, name: "Added", version: 1)
        if removeFirst { server.remove(2) }
        await model.reloadSharedLists(session: model.sessionID); gate.release(reply); await write.value
        #expect(model.sharedLists.map(\.id) == (removeFirst ? [1, 4] : [2, 1, 4]))
        #expect(model.sharedLists.first { $0.id == 1 }?.payload.name == "Latest")
        await model.signOut()
    }
    @Test func intentsCapturedBeforeSignOutCannotWriteToANewConnection() async throws {
        let (model, _, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let value = try plan(model), row = try #require(model.sharedLists.first), draft = model.listNameDraft, session = model.sessionID
        draft.text = "Old"; await model.signOut(); model.serverText = "https://second.example.com"; await model.restoreSession(force: true); try await model.refreshLists(); requests.clear()
        model.listNameDraft.text = "New"
        let created = await model.createList(value), submitted = await model.submitListCreation(value, draft: draft, revision: draft.revision)
        let renamed = await model.renameList(row, name: "Old", session: session), deleted = await model.deleteList(row, session: session)
        await model.moveList(row, direction: "down", session: session)
        #expect(!created && !submitted && !renamed && !deleted && requests.writes.isEmpty && model.listNameDraft.text == "New" && model.listManagementError == nil)
        await model.signOut()
    }
    @Test func aMoveReplyCannotReplaceAnOrderReadWhileTheWriteWasPending() async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let writeGate = ListsGate(), readGate = ListsGate(), row = try #require(model.sharedLists.first)
        ListsProtocol.handler = { request in if request.request.httpMethod == "POST" { writeGate.hold(request) } else { server.handle(request) } }
        let write = Task { await model.moveList(row, direction: "down") }; try await eventually { writeGate.waiting }
        let reply = try #require(writeGate.commit(using: server))
        server.order([1, 2]); await model.reloadSharedLists(session: model.sessionID)
        ListsProtocol.handler = { request in if request.request.url?.path == "/api/watchlists" { readGate.hold(request) } else { server.handle(request) } }
        writeGate.release(reply); await write.value; try await eventually { readGate.waiting }
        #expect(model.sharedLists.map(\.id) == [1, 2] && model.listManagementMessage == "Watchlists reordered.")
        readGate.release(using: server); try await eventually { !model.loadingSharedLists }; await model.signOut()
    }
    @Test(arguments: [200, 401]) func lateCreationCannotClearAnotherServersNameOrProgress(status: Int) async throws {
        let (model, server, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let old = ListsGate(), logout = ListsGate(), latest = ListsGate(), second = ListsServer(), draft = model.listNameDraft
        draft.text = "Old"; let value = try plan(model, name: draft.text), revision = draft.revision
        ListsProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.httpMethod == "POST" { latest.hold(request) } else { second.handle(request) }
        }
        let first = Task { await model.submitListCreation(value, draft: draft, revision: revision) }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(draft.text.isEmpty && !draft.creating)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true); try await model.refreshLists()
        let current = model.listNameDraft; current.text = "New"; let nextPlan = try plan(model, name: current.text), nextRevision = current.revision
        let next = Task { await model.submitListCreation(nextPlan, draft: current, revision: nextRevision) }; try await eventually { latest.waiting }
        if status == 200 { old.release(using: server) } else { old.release(ListsReply(status: status, body: "")) }; let obsolete = await first.value
        #expect(!obsolete && model.signedIn && model.managingLists && current.creating && current.text == "New" && model.listManagementMessage == nil)
        logout.release(ListsReply(status: 200, body: #"{"ok":true}"#)); await signOut.value
        latest.release(using: second); let saved = await next.value
        #expect(saved && current.text.isEmpty && !current.creating && model.sharedLists.last?.payload.name == "New")
        await model.signOut()
    }
    @Test(arguments: ["write", "read"]) func currentUnauthorizedResponsesClearDraftAndListState(stage: String) async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let draft = model.listNameDraft; draft.text = "Created"; let value = try plan(model, name: draft.text)
        ListsProtocol.handler = { request in
            if (stage == "write" && request.request.httpMethod == "POST") || (stage == "read" && request.request.httpMethod == "GET" && request.request.url?.path == "/api/watchlists") { request.respond(401, "") }
            else { server.handle(request) }
        }
        await model.submitListCreation(value, draft: draft, revision: draft.revision); try await eventually { !model.signedIn }
        #expect(draft.text.isEmpty && !draft.creating && model.sharedLists.isEmpty && model.listManagementMessage == nil && model.sharedListReadError == nil && !model.managingLists && !model.loadingSharedLists)
    }
    @Test func cancellationKeepsTheNameAndDoesNotStartAnAutomaticReadOrRetry() async throws {
        let (model, _, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let draft = model.listNameDraft, gate = ListsGate(); draft.text = "Created"; let value = try plan(model, name: draft.text), revision = draft.revision
        ListsProtocol.handler = { requests.append($0.captured); gate.hold($0) }
        let write = Task { await model.submitListCreation(value, draft: draft, revision: revision) }; try await eventually { gate.waiting }
        write.cancel(); let saved = await write.value
        #expect(!saved && draft.text == "Created" && !draft.creating && !model.managingLists && !model.loadingSharedLists && model.listManagementError == nil && requests.posts.count == 1)
        ListsProtocol.handler = { $0.respond(200, #"{"ok":true}"#) }; await model.signOut()
    }
    @Test func failedWriteKeepsItsNameAndUsesWriteFeedback() async throws {
        let (model, server, _) = try await fixture(); defer { ListsProtocol.handler = nil }
        let draft = model.listNameDraft; draft.text = "Created"; let value = try plan(model, name: draft.text)
        ListsProtocol.handler = { request in if request.request.httpMethod == "POST" { request.respond(503, "") } else { server.handle(request) } }
        let saved = await model.submitListCreation(value, draft: draft, revision: draft.revision)
        try await eventually { !model.loadingSharedLists }
        #expect(!saved && draft.text == "Created" && !draft.creating && model.listManagementError != nil && model.listManagementMessage == nil && model.sharedListReadError == nil && model.sharedLists.count == 2)
        await model.signOut()
    }
    @Test func utf16BoundsAndStaleReviewedRowsAreRejectedBeforeWriting() async throws {
        let (model, _, requests) = try await fixture(); defer { ListsProtocol.handler = nil }
        let row = try #require(model.sharedLists.first)
        let invalid = model.prepareListCreation(name: String(repeating: "😀", count: 33), copying: nil, session: model.sessionID, selection: model.listSelection)
        let valid = model.prepareListCreation(name: String(repeating: "😀", count: 32), copying: row, session: model.sessionID, selection: model.listSelection)
        let renamed = await model.renameList(row, name: String(repeating: "😀", count: 33))
        #expect(invalid == nil && valid != nil && !renamed && requests.writes.isEmpty)
        let invalidSource = SharedWatchlist(id: 1, version: 1, name: "Legacy", symbols: ["<script>"])
        let refused = model.prepareListCreation(name: "Copy", copying: invalidSource, session: model.sessionID, selection: model.listSelection)
        #expect(refused == nil && model.listManagementError == "This watchlist cannot be copied. Refresh and try again.")
        model.sharedLists[0] = SharedWatchlist(id: row.id, version: 2, name: "Latest", symbols: row.payload.symbols)
        let staleRename = await model.renameList(row, name: "Old"), staleDelete = await model.deleteList(row)
        await model.moveList(row, direction: "down")
        #expect(!staleRename && !staleDelete && requests.writes.isEmpty)
        await model.signOut()
    }
}

@MainActor private final class ListsCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-lists-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class ListsDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
    override func stringArray(forKey key: String) -> [String]? { nil }
}
private final class ListsRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { values } }
    var posts: [URLRequest] { all.filter { $0.httpMethod == "POST" } }
    var writes: [URLRequest] { all.filter { ["POST", "PUT", "DELETE"].contains($0.httpMethod) } }
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func clear() { lock.withLock { values = [] } }
}
private struct ListsReply { let status: Int; let body: String }
private final class ListsGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: ListsProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ request: ListsProtocol) { lock.withLock { held = request } }
    private func take() -> ListsProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { release(ListsReply(status: status, body: body)) }
    func release(_ reply: ListsReply) { take()?.respond(reply.status, reply.body) }
    func release(using server: ListsServer) { if let request = take() { server.handle(request) } }
    func commit(using server: ListsServer) -> ListsReply? { lock.withLock { held.map { server.reply($0) } } }
}
private final class ListsServer: @unchecked Sendable {
    private struct Row { var name: String; var symbols: [String]; var version: Int }
    private let lock = NSLock(); private var ids = [1, 2]
    private var rows = [1: Row(name: "One", symbols: ["AAPL", "MSFT"], version: 1), 2: Row(name: "Two", symbols: ["TSLA"], version: 1)]
    func update(_ id: Int, name: String, version: Int) { lock.withLock { if !ids.contains(id) { ids.append(id) }; rows[id] = Row(name: name, symbols: rows[id]?.symbols ?? ["SPY"], version: version) } }
    func remove(_ id: Int) { lock.withLock { rows[id] = nil; ids.removeAll { $0 == id } } }
    func order(_ value: [Int]) { lock.withLock { ids = value } }
    private func object(_ id: Int) -> [String: Any] { let row = rows[id]!; return ["id": id, "version": row.version, "payload": ["name": row.name, "symbols": row.symbols]] }
    private func json(_ value: Any) -> String { String(decoding: try! JSONSerialization.data(withJSONObject: value), as: UTF8.self) }
    func lists() -> String { lock.withLock { json(ids.map { object($0) }) } }
    func reply(_ request: ListsProtocol) -> ListsReply {
        let path = request.request.url!.path, method = request.request.httpMethod!, body = ListsProtocol.body(request.captured) ?? [:]
        return lock.withLock {
            if path == "/api/mobile/session" { return ListsReply(status: 200, body: method == "DELETE" ? #"{"ok":true}"# : #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
            if path == "/api/watchlists/default" { return ListsReply(status: 200, body: #"{"id":null}"#) }
            if path == "/api/watchlists" {
                if method == "POST" { let id = (ids.max() ?? 2) + 1; ids.append(id); rows[id] = Row(name: body["name"] as! String, symbols: body["symbols"] as! [String], version: 1); return ListsReply(status: 201, body: json(["id": id])) }
                return ListsReply(status: 200, body: json(ids.map { object($0) }))
            }
            if path.hasPrefix("/api/watchlists/") {
                let parts = path.split(separator: "/"), id = Int(parts[2])!
                guard var row = rows[id] else { return ListsReply(status: 404, body: #"{"error":"Missing list"}"#) }
                if method == "DELETE" { rows[id] = nil; ids.removeAll { $0 == id }; return ListsReply(status: 204, body: "") }
                if path.hasSuffix("/move") {
                    let index = ids.firstIndex(of: id)!, next = index + (body["direction"] as? String == "up" ? -1 : 1)
                    if ids.indices.contains(next) { ids.swapAt(index, next) }
                    return ListsReply(status: 200, body: json(ids.map { object($0) }))
                }
                if let name = body["name"] as? String { row.name = name }
                if let symbols = body["symbols"] as? [String] { row.symbols = symbols }
                row.version += 1; rows[id] = row; return ListsReply(status: 200, body: json(object(id)))
            }
            if path == "/api/briefings/current" { return ListsReply(status: 200, body: #"{"date":"2026-10-29","summary":"Ready","indexes":[],"headlines":[],"warnings":[]}"#) }
            if path == "/api/alerts" { return ListsReply(status: 200, body: #"{"alerts":[]}"#) }
            if path == "/api/quotes" || path == "/api/portfolios" { return ListsReply(status: 200, body: "[]") }
            return ListsReply(status: 404, body: #"{"error":"Unexpected lists fixture"}"#)
        }
    }
    func handle(_ request: ListsProtocol) { let value = reply(request); request.respond(value.status, value.body) }
}
private final class ListsProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (ListsProtocol) -> Void)?
    private let lock = NSLock(); private var stopped = false; private var payload: Data?
    var captured: URLRequest { var value = request; value.httpBody = payload; return value }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        payload = request.httpBody
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096), data = Data()
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
            payload = data
        }
        Self.handler?(self)
    }
    override func stopLoading() { lock.withLock { stopped = true } }
    func respond(_ status: Int, _ body: String) {
        guard !lock.withLock({ stopped }) else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    static func body(_ request: URLRequest) -> [String: Any]? { request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
}
