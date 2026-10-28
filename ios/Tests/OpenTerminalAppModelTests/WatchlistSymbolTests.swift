import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct WatchlistSymbolTests {
    private func fixture() async throws -> (TerminalModel, SymbolServer, SymbolRequests) {
        let server = SymbolServer(), requests = SymbolRequests()
        SymbolProtocol.handler = { requests.append($0.captured); server.handle($0) }
        let model = TerminalModel(defaults: SymbolDefaults(suiteName: "symbols-memory-\(UUID())")!, credentials: SymbolCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SymbolProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession(); try await model.refreshLists()
        requests.clear(); return (model, server, requests)
    }
    private func entry(_ model: TerminalModel, id: Int = 1) throws -> WatchlistSymbolEntry { try #require(model.symbolEntry(for: id)) }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        try #require(predicate(), "Expected symbol operation did not start")
    }
    private func markets(_ model: TerminalModel, after: Date? = nil) async throws {
        try await eventually { model.sectionUpdated[.watchlist] != nil && model.sectionUpdated[.briefing] != nil && (after == nil || model.sectionUpdated[.watchlist] != after) && !model.loadingSections.contains(.watchlist) && !model.loadingSections.contains(.briefing) }
    }
    @Test func invalidInputStaysVisibleAndEntriesBelongToTheirOwnList() async throws {
        let (model, _, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let one = try entry(model), two = try entry(model, id: 2)
        one.text = "<script>"; await model.addSymbol(one)
        #expect(one.text == "<script>" && one.error != nil && !one.saving && requests.all.isEmpty)
        one.text = "MSFT"; two.text = "NVDA"
        #expect(one.error == nil && one !== two)
        let reopened = try entry(model); #expect(reopened === one && reopened.text == "MSFT" && two.text == "NVDA")
    }
    @Test func acknowledgementEndsAddingBeforeIndependentQuotesAndBriefing() async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), quotes = SymbolGate(), briefing = SymbolGate(); state.text = " msft "
        SymbolProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.url?.path == "/api/quotes" { quotes.hold(request) }
            else if request.request.url?.path == "/api/briefings/current" { briefing.hold(request) }
            else { server.handle(request) }
        }
        await model.addSymbol(state); try await eventually { quotes.waiting && briefing.waiting }
        #expect(!state.saving && state.text.isEmpty && state.error == nil && state.message == "Symbol added." && model.pendingSymbolChanges.isEmpty)
        #expect(model.watchlist == ["AAPL", "MSFT"] && model.sharedLists.first?.version == 2)
        let write = try #require(requests.writes.first), body = try #require(SymbolProtocol.body(write))
        #expect(write.url?.path == "/api/watchlists/1/symbols" && body["symbol"] as? String == "MSFT" && body["action"] as? String == "add")
        quotes.release(503, #"{"error":"Quotes unavailable"}"#); briefing.release(using: server)
        try await eventually { model.sectionErrors[.watchlist] != nil && model.sectionUpdated[.briefing] != nil && !model.loadingSections.contains(.watchlist) }
        #expect(state.error == nil && state.message == "Symbol added." && model.pendingSymbolChanges.isEmpty)
    }
    @Test func failedAddKeepsInputAndExplicitRetryClearsOnlyConfirmedText() async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model); state.text = "MSFT"
        SymbolProtocol.handler = { request in requests.append(request.captured); request.respond(503, #"{"error":"Try again"}"#) }
        await model.addSymbol(state)
        #expect(state.text == "MSFT" && state.error != nil && !state.saving && model.error == nil && !model.reconnecting && model.watchlist == ["AAPL"])
        #expect(model.symbolChangeErrors[WatchlistSymbolKey(listID: 1, symbol: "MSFT")]?.action == .add)
        state.text = "NVDA"; #expect(state.error == nil)
        SymbolProtocol.handler = { requests.append($0.captured); server.handle($0) }; await model.addSymbol(state); try await markets(model)
        #expect(state.text.isEmpty && state.error == nil && model.watchlist == ["AAPL", "NVDA"] && requests.writes.count == 2)
    }
    @Test(arguments: [false, true]) func editsDuringAnAddSurviveIncludingReturningToTheSameText(returnToOriginal: Bool) async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), gate = SymbolGate(); state.text = "MSFT"
        SymbolProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) }
        }
        let add = Task { await model.addSymbol(state) }; try await eventually { gate.waiting }
        state.text = "NVDA"; if returnToOriginal { state.text = "MSFT" }
        await model.addSymbol(state); #expect(requests.writes.count == 1)
        gate.release(using: server); await add.value; try await markets(model)
        #expect(state.text == (returnToOriginal ? "MSFT" : "NVDA") && state.message == "Symbol added. Newer input is kept." && !state.saving)
    }
    @Test func anEntryCapturedBeforeSelectionChangesStillWritesItsOriginalList() async throws {
        let (model, _, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let one = try entry(model), two = try entry(model, id: 2); one.text = "MSFT"; two.text = "NVDA"
        model.chooseList(2); try await markets(model); let before = requests.all.count
        await model.addSymbol(one)
        #expect(requests.all.dropFirst(before).map { $0.url?.path } == ["/api/watchlists/1/symbols"])
        #expect(model.sharedListID == 2 && model.watchlist == ["TSLA"] && two.text == "NVDA" && one.text.isEmpty)
        #expect(model.sharedLists.first { $0.id == 1 }?.payload.symbols == ["AAPL", "MSFT"])
    }
    @Test func aFailedAddReportsItsOriginalSymbolWithoutReplacingNewerInput() async throws {
        let (model, _, _) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), gate = SymbolGate(); state.text = "MSFT"
        SymbolProtocol.handler = { gate.hold($0) }
        let add = Task { await model.addSymbol(state) }; try await eventually { gate.waiting }
        state.text = "NVDA"; gate.release(503, ""); await add.value
        #expect(state.text == "NVDA" && state.error == nil && state.message == "Could not add MSFT. Your current input is kept." && !state.saving)
    }
    @Test(arguments: [200, 503]) func selectionDuringAWriteDoesNotReceiveItsDataOrFeedback(status: Int) async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let one = try entry(model), two = try entry(model, id: 2), gate = SymbolGate(); one.text = "MSFT"; two.text = "NVDA"
        SymbolProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) }
        }
        let add = Task { await model.addSymbol(one) }; try await eventually { gate.waiting }
        model.chooseList(2); try await markets(model); let updated = model.sectionUpdated[.watchlist]
        if status == 200 { gate.release(using: server) } else { gate.release(status, "") }; await add.value
        #expect(model.watchlist == ["TSLA"] && model.sharedListID == 2 && model.sectionUpdated[.watchlist] == updated)
        #expect(two.text == "NVDA" && two.error == nil && two.message == nil && model.error == nil && !model.reconnecting)
        #expect(one.text == (status == 200 ? "" : "MSFT") && (status == 200 || one.error != nil))
    }
    @Test func duplicateOppositeAndWholeListWritesAreBlockedUntilAcknowledgement() async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), gate = SymbolGate(), row = try #require(model.sharedLists.first)
        let workspace = try JSONDecoder().decode(SharedWorkspace.self, from: Data(#"{"id":"layout","name":"Desk","watchlist":["NVDA"]}"#.utf8))
        model.workspaces = [workspace]; let plan = try #require(model.prepareWorkspaceImport(workspace))
        state.text = "MSFT"
        SymbolProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { server.handle(request) }
        }
        let add = Task { await model.addSymbol(state) }; try await eventually { gate.waiting }
        let duplicate = await model.changeSymbol("MSFT", action: .add, listID: 1, session: model.sessionID)
        let opposite = await model.changeSymbol("MSFT", action: .remove, listID: 1, session: model.sessionID)
        let created = await model.createList(name: "Blocked"), renamed = await model.renameList(row, name: "Blocked"), deleted = await model.deleteList(row)
        await model.moveList(row, direction: "up"); await model.importWorkspace(plan)
        #expect(!duplicate && !opposite && !created && !renamed && !deleted && model.prepareWorkspaceImport(workspace) == nil && model.listWritesBusy)
        #expect(requests.writes.count == 1 && !model.managingLists && !model.importingWorkspace)
        gate.release(using: server); await add.value; try await markets(model)
        #expect(!model.listWritesBusy)
    }
    @Test func symbolWritesWaitForWholeListOperationsWithoutDroppingInput() async throws {
        let (model, _, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model); state.text = "MSFT"; model.managingLists = true
        await model.addSymbol(state)
        let removed = await model.changeSymbol("AAPL", action: .remove, listID: 1, session: model.sessionID)
        #expect(!removed && state.text == "MSFT" && state.error != nil && requests.writes.isEmpty && model.pendingSymbolChanges.isEmpty)
        model.managingLists = false
    }
    @Test func olderAcknowledgementCannotUndoAnotherSymbolsNewerResponse() async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let old = SymbolGate(), latest = SymbolGate(), session = model.sessionID
        SymbolProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "POST" {
                if SymbolProtocol.body(request.captured)?["symbol"] as? String == "MSFT" { old.hold(request) } else { latest.hold(request) }
            } else { server.handle(request) }
        }
        let first = Task { await model.changeSymbol("MSFT", action: .add, listID: 1, session: session) }; try await eventually { old.waiting }
        let second = Task { await model.changeSymbol("GOOG", action: .add, listID: 1, session: session) }; try await eventually { latest.waiting }
        let committed = try #require(old.commit(using: server))
        latest.release(using: server); let secondSaved = await second.value; try await markets(model); let time = model.sectionUpdated[.watchlist]
        old.release(200, committed); let firstSaved = await first.value
        #expect(firstSaved && secondSaved && model.watchlist == ["AAPL", "MSFT", "GOOG"] && model.sharedLists.first?.version == 3)
        #expect(model.sectionUpdated[.watchlist] == time && model.pendingSymbolChanges.isEmpty)
    }
    @Test func failedRemovalKeepsTheRowAndCanBeRetriedWithoutGlobalConnectionErrors() async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let key = WatchlistSymbolKey(listID: 1, symbol: "AAPL"), session = model.sessionID
        SymbolProtocol.handler = { requests.append($0.captured); $0.respond(503, "") }
        let failed = await model.changeSymbol("AAPL", action: .remove, listID: 1, session: session)
        #expect(!failed && model.watchlist == ["AAPL"] && model.symbolChangeErrors[key]?.action == .remove && model.error == nil && !model.reconnecting)
        SymbolProtocol.handler = { requests.append($0.captured); server.handle($0) }
        let removed = await model.changeSymbol("AAPL", action: .remove, listID: 1, session: session); try await markets(model)
        #expect(removed && model.watchlist.isEmpty && model.symbolChangeErrors[key] == nil && requests.writes.count == 2)
    }
    @Test(arguments: [200, 401]) func aPreWriteListReadCannotUndoTheWriteOrSignOut(status: Int) async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), old = SymbolGate(); state.text = "MSFT"
        let oldRows = server.lists()
        SymbolProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.url?.path == "/api/watchlists" && request.request.httpMethod == "GET" { old.hold(request) } else { server.handle(request) }
        }
        let read = Task { await model.refresh() }; try await eventually { old.waiting }
        await model.addSymbol(state); try await markets(model)
        old.release(status, status == 200 ? oldRows : ""); await read.value
        #expect(model.signedIn && model.error == nil && model.watchlist == ["AAPL", "MSFT"] && model.sectionErrors[.watchlist] == nil)
    }
    @Test func aDelayedResponseCannotResurrectAListAlreadyRemovedFromTheCache() async throws {
        let (model, server, _) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), old = SymbolGate(); state.text = "MSFT"
        SymbolProtocol.handler = { request in if request.request.httpMethod == "POST" { old.hold(request) } else { server.handle(request) } }
        let add = Task { await model.addSymbol(state) }; try await eventually { old.waiting }
        let committed = try #require(old.commit(using: server)); server.remove(1)
        model.sharedLists.removeAll { $0.id == 1 }; model.chooseList(2); try await markets(model)
        old.release(200, committed); await add.value
        #expect(model.sharedLists.map(\.id) == [2] && model.watchlist == ["TSLA"] && model.sharedListID == 2)
    }
    @Test(arguments: [200, 401]) func lateResponsesCannotTouchInputOrProgressOnAnotherServer(status: Int) async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), old = SymbolGate(), logout = SymbolGate(), latest = SymbolGate(), nextServer = SymbolServer()
        state.text = "MSFT"; let oldSession = model.sessionID
        SymbolProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.url?.path == "/api/watchlists/1/symbols" { latest.hold(request) } else { nextServer.handle(request) }
        }
        let first = Task { await model.addSymbol(state) }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(state.text.isEmpty && !state.saving && model.pendingSymbolChanges.isEmpty && model.symbolChangeErrors.isEmpty)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true); try await model.refreshLists()
        let current = try entry(model); current.text = "MSFT"
        let second = Task { await model.addSymbol(current) }; try await eventually { latest.waiting }
        await model.addSymbol(state)
        let rejected = await model.changeSymbol("NVDA", action: .add, listID: 1, session: oldSession)
        #expect(!rejected)
        if status == 200 { old.release(using: server) } else { old.release(status, "") }; await first.value
        #expect(model.signedIn && current.saving && current.text == "MSFT" && current.error == nil && model.pendingSymbolChanges == [WatchlistSymbolKey(listID: 1, symbol: "MSFT")])
        logout.release(200, #"{"ok":true}"#); await signOut.value
        latest.release(using: nextServer); await second.value; try await markets(model)
        #expect(current.text.isEmpty && !current.saving && model.watchlist == ["AAPL", "MSFT"])
    }
    @Test func currentUnauthorizedWriteClearsInputsAndRequiresSignIn() async throws {
        let (model, server, _) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model); state.text = "MSFT"
        SymbolProtocol.handler = { request in if request.request.httpMethod == "POST" { request.respond(401, "") } else { server.handle(request) } }
        await model.addSymbol(state)
        #expect(!model.signedIn && state.text.isEmpty && !state.saving && state.error == nil && model.error != nil)
        #expect(model.sharedLists.isEmpty && model.symbolChangeErrors.isEmpty && model.pendingSymbolChanges.isEmpty)
    }
    @Test func cancellationKeepsInputWithoutAnErrorOrAutomaticRetry() async throws {
        let (model, _, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), gate = SymbolGate(); state.text = "MSFT"
        SymbolProtocol.handler = { requests.append($0.captured); gate.hold($0) }
        let add = Task { await model.addSymbol(state) }; try await eventually { gate.waiting }
        add.cancel(); await add.value
        #expect(state.text == "MSFT" && !state.saving && state.error == nil && model.pendingSymbolChanges.isEmpty && model.symbolChangeErrors.isEmpty && requests.writes.count == 1)
    }
    @Test func removedOrInvalidTargetsNeverProduceWrites() async throws {
        let (model, _, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let invalid = await model.changeSymbol("<script>", action: .add, listID: 1, session: model.sessionID)
        let removed = await model.changeSymbol("MSFT", action: .add, listID: 999, session: model.sessionID)
        #expect(!invalid && !removed && requests.all.isEmpty && model.pendingSymbolChanges.isEmpty)
    }
    @Test func aResponseForAnotherListCannotClearInputOrChangeEitherCachedList() async throws {
        let (model, _, _) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model), before = model.sharedLists; state.text = "MSFT"
        SymbolProtocol.handler = { $0.respond(200, #"{"id":2,"version":2,"payload":{"name":"Two","symbols":["TSLA","MSFT"]}}"#) }
        await model.addSymbol(state)
        #expect(state.text == "MSFT" && state.error != nil && model.sharedLists == before && model.pendingSymbolChanges.isEmpty)
    }
    @Test func symbolReorderingUsesTheReviewedListAndRejectsChangedVersions() async throws {
        let (model, server, requests) = try await fixture(); defer { SymbolProtocol.handler = nil }
        server.set(1, symbols: ["AAPL", "MSFT"]); try await model.refreshLists()
        let row = try #require(model.sharedLists.first), session = model.sessionID
        model.chooseList(2); try await markets(model); let before = model.sectionUpdated[.watchlist]
        await model.moveSymbol("MSFT", direction: -1, in: row, session: session); try await markets(model, after: before)
        #expect(model.sharedLists.first?.payload.symbols == ["MSFT", "AAPL"] && model.watchlist == ["TSLA"] && requests.writes.last?.url?.path == "/api/watchlists/1/reorder-symbols")
        let count = requests.writes.count
        await model.moveSymbol("MSFT", direction: 1, in: row, session: session)
        await model.moveSymbol("MSFT", direction: Int.max, in: row, session: session)
        #expect(requests.writes.count == count && model.listManagementError != nil)
    }
    @Test func aMissingListIsRefreshedWithoutRecreatingItOrDroppingTheInput() async throws {
        let (model, server, _) = try await fixture(); defer { SymbolProtocol.handler = nil }
        let state = try entry(model); state.text = "MSFT"; server.remove(1)
        await model.addSymbol(state)
        try await eventually { model.sharedListID == 2 && model.sharedLists.map(\.id) == [2] }
        try await markets(model)
        #expect(state.text == "MSFT" && state.error != nil && model.sharedLists.count == 1 && model.error == nil)
    }
}

@MainActor private final class SymbolCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-symbol-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class SymbolDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
    override func stringArray(forKey key: String) -> [String]? { nil }
}
private final class SymbolRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { values } }
    var writes: [URLRequest] { all.filter { ["POST", "PUT", "DELETE"].contains($0.httpMethod) } }
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func clear() { lock.withLock { values = [] } }
}
private final class SymbolGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: SymbolProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: SymbolProtocol) { lock.withLock { held = value } }
    private func take() -> SymbolProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func release(using server: SymbolServer) { if let request = take() { server.handle(request) } }
    func commit(using server: SymbolServer) -> String? { lock.withLock { held.map { server.change($0) } } }
}
private final class SymbolServer: @unchecked Sendable {
    private struct Row { var name: String; var symbols: [String]; var version = 1 }
    private let lock = NSLock(); private var rows = [1: Row(name: "One", symbols: ["AAPL"]), 2: Row(name: "Two", symbols: ["TSLA"])]
    func set(_ id: Int, symbols: [String]) { lock.withLock { rows[id]?.symbols = symbols } }
    func remove(_ id: Int) { _ = lock.withLock { rows.removeValue(forKey: id) } }
    private func object(_ id: Int, _ row: Row) -> [String: Any] { ["id": id, "version": row.version, "payload": ["name": row.name, "symbols": row.symbols]] }
    private func json(_ value: Any) -> String { String(decoding: try! JSONSerialization.data(withJSONObject: value), as: UTF8.self) }
    func lists() -> String { lock.withLock { json(rows.keys.sorted().map { object($0, rows[$0]!) }) } }
    func change(_ request: SymbolProtocol) -> String {
        let id = Int(request.request.url!.path.split(separator: "/")[2])!, body = SymbolProtocol.body(request.captured) ?? [:]
        return lock.withLock {
            guard var row = rows[id] else { return #"{"error":"Watchlist no longer exists."}"# }
            if let symbols = body["symbols"] as? [String] { row.symbols = symbols }
            else if let symbol = body["symbol"] as? String {
                if body["action"] as? String == "remove" { row.symbols.removeAll { $0 == symbol } }
                else if !row.symbols.contains(symbol) { row.symbols.append(symbol) }
            }
            row.version += 1; rows[id] = row; return json(object(id, row))
        }
    }
    func handle(_ request: SymbolProtocol) {
        let path = request.request.url?.path ?? ""
        if request.request.httpMethod == "DELETE" { request.respond(200, #"{"ok":true}"#) }
        else if path == "/api/mobile/session" { request.respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if path == "/api/watchlists" { request.respond(200, lists()) }
        else if path.hasSuffix("/symbols") || path.hasSuffix("/reorder-symbols") { let body = change(request); request.respond(body.contains("Watchlist no longer") ? 404 : 200, body) }
        else if path == "/api/briefings/current" { request.respond(200, #"{"date":"2026-10-28","summary":"Ready","indexes":[],"headlines":[],"warnings":[]}"#) }
        else if path == "/api/alerts" { request.respond(200, #"{"alerts":[]}"#) }
        else if path == "/api/quotes" || path == "/api/portfolios" { request.respond(200, "[]") }
        else if path == "/api/watchlists/default" { request.respond(200, #"{"id":null}"#) }
        else { request.respond(404, #"{"error":"Unexpected symbol fixture"}"#) }
    }
}
private final class SymbolProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (SymbolProtocol) -> Void)?
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
