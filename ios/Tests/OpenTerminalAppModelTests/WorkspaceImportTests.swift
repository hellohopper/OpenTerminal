import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct WorkspaceImportTests {
    private func fixture() async throws -> (TerminalModel, ImportRequests) {
        let requests = ImportRequests()
        ImportProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let model = TerminalModel(defaults: ImportDefaults(suiteName: "import-memory-\(UUID())")!, credentials: ImportCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ImportProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession()
        installLists(model); await model.loadWorkspaces(session: model.sessionID)
        requests.clear(); return (model, requests)
    }
    private func installLists(_ model: TerminalModel) {
        model.sharedLists = try! JSONDecoder().decode([SharedWatchlist].self, from: Data(ImportProtocol.listJSON().utf8))
        model.sharedListID = 1; model.watchlist = ["AAPL"]
    }
    private func plan(_ model: TerminalModel) throws -> WatchlistImportPlan {
        let source = try #require(model.workspaces.first)
        return try #require(model.prepareWorkspaceImport(source))
    }
    private func source(_ symbols: [String]) throws -> SharedWorkspace {
        try JSONDecoder().decode(SharedWorkspace.self, from: JSONSerialization.data(withJSONObject: ["id": "layout", "name": "Desk", "watchlist": symbols]))
    }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<200 { if condition() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(condition(), "Expected import or refresh did not complete")
    }
    private func refreshed(_ model: TerminalModel) async throws {
        try await eventually { model.sectionUpdated[.watchlist] != nil && model.sectionUpdated[.briefing] != nil && !model.loadingSections.contains(.watchlist) && !model.loadingSections.contains(.briefing) }
    }

    @Test func reviewedPlanCapturesTheTargetAndNormalizesSymbolsWithoutWriting() async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model)
        #expect(value.target.id == 1 && value.target.version == 1 && value.target.payload.name == "One")
        #expect(value.session == model.sessionID && value.workspace.name == "Desk" && value.symbols == ["MSFT", "SPY"])
        #expect(value.workspace.watchlist == [" msft ", "SPY", "msft"] && model.watchlist == ["AAPL"] && requests.all.isEmpty)
    }

    @Test func acknowledgementEndsImportBeforeListOrMarketLoadingAndBlocksDuplicateWrites() async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model), write = ImportGate(), list = ImportGate()
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "PUT" { write.hold(request) }
            else if request.request.url?.path == "/api/watchlists" { list.hold(request) }
            else { request.fixture() }
        }
        let action = Task { await model.importWorkspace(value) }; try await eventually { write.waiting }
        #expect(model.importingWorkspace && model.managingLists && model.prepareWorkspaceImport(value.workspace) == nil)
        await model.importWorkspace(value)
        let created = await model.createList(name: "Cannot race the import"); #expect(!created && requests.all.count == 1)
        let put = try #require(requests.all.first)
        let body = try #require(ImportProtocol.body(put))
        #expect(body["name"] as? String == "One" && body["version"] as? Int == 1 && body["symbols"] as? [String] == ["MSFT", "SPY"])
        write.release(200, #"{"ok":true}"#); await action.value
        #expect(!model.importingWorkspace && !model.managingLists && model.workspaceImportError == nil && model.workspaceImportMessage == "Watchlist imported.")
        #expect(model.watchlist == ["MSFT", "SPY"] && model.sharedLists.first?.version == 2)
        try await eventually { list.waiting }
        #expect(requests.all.count == 2)
        list.releaseLists(symbols: ["MSFT", "SPY"], version: 2); try await refreshed(model)
        #expect(model.workspaces == [value.workspace])
    }

    @Test(arguments: ["selection", "version", "source"]) func changedConfirmationCannotWriteToAnotherOrNewerTarget(change: String) async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model)
        if change == "selection" { model.sharedListID = 2; model.watchlist = ["TSLA"] }
        else if change == "version" { model.sharedLists[0] = value.target.replacingSymbols(["AAPL", "GOOG"], version: 2) }
        else { model.workspaces = [try source(["NVDA"])] }
        let before = model.sharedLists
        await model.importWorkspace(value)
        #expect(model.workspaceImportError != nil && model.sharedLists == before && requests.all.isEmpty)
        #expect(!model.importingWorkspace && !model.managingLists)
    }

    @Test func changingSelectionDuringAWriteDoesNotRetargetTheImportOrReplaceTheNewSelection() async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model), write = ImportGate()
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "PUT" { write.hold(request) }
            else if request.request.url?.path == "/api/watchlists" { request.lists(symbols: ["MSFT", "SPY"], version: 2) }
            else { request.fixture() }
        }
        let action = Task { await model.importWorkspace(value) }; try await eventually { write.waiting }
        model.chooseList(2); try await refreshed(model)
        write.release(200, #"{"ok":true}"#); await action.value
        try await eventually { requests.all.filter { $0.url?.path == "/api/briefings/current" }.count == 2 }
        try await refreshed(model)
        #expect(model.sharedListID == 2 && model.watchlist == ["TSLA"])
        #expect(model.sharedLists.first { $0.id == 1 }?.payload.symbols == ["MSFT", "SPY"])
        #expect(requests.all.filter { $0.httpMethod == "PUT" }.map { $0.url?.path } == ["/api/watchlists/1"])
    }

    @Test func delayedAcknowledgementPreservesANewerTargetAlreadyObservedLocally() async throws {
        let (model, _) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model), write = ImportGate(), list = ImportGate()
        ImportProtocol.handler = { request in
            if request.request.httpMethod == "PUT" { write.hold(request) }
            else if request.request.url?.path == "/api/watchlists" { list.hold(request) }
            else { request.fixture() }
        }
        let action = Task { await model.importWorkspace(value) }; try await eventually { write.waiting }
        model.sharedLists[0] = value.target.replacingSymbols(["NVDA"], version: 3); model.watchlist = ["NVDA"]
        write.release(200, #"{"ok":true}"#); await action.value
        #expect(model.watchlist == ["NVDA"] && model.sharedLists.first?.version == 3)
        try await eventually { list.waiting }; list.releaseLists(symbols: ["NVDA"], version: 3); try await refreshed(model)
    }

    @Test func importRefreshDoesNotDiscardMarketDataForAnotherSelectedList() async throws {
        let (model, _) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model), write = ImportGate(), quotes = ImportGate()
        ImportProtocol.handler = { request in
            if request.request.httpMethod == "PUT" { write.hold(request) }
            else if request.request.url?.path == "/api/quotes" { quotes.hold(request) }
            else if request.request.url?.path == "/api/watchlists" { request.respond(503, #"{"error":"Lists unavailable"}"#) }
            else { request.fixture() }
        }
        let action = Task { await model.importWorkspace(value) }; try await eventually { write.waiting }
        model.chooseList(2); try await eventually { quotes.waiting && model.sectionUpdated[.briefing] != nil }
        write.release(200, #"{"ok":true}"#); await action.value
        try await eventually { model.sectionErrors[.watchlist] != nil }
        quotes.release(200, #"[{"symbol":"TSLA","price":250,"source":"fixture"}]"#)
        try await eventually { model.quotes.first?.symbol == "TSLA" && !model.loadingSections.contains(.watchlist) }
        #expect(model.sharedListID == 2 && model.watchlist == ["TSLA"] && model.workspaceImportError == nil)
    }

    @Test func failedFollowUpReadDoesNotTurnAnAcknowledgedImportIntoAWriteFailure() async throws {
        let (model, _) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model)
        ImportProtocol.handler = { request in
            if request.request.httpMethod == "PUT" { request.fixture() } else { request.respond(503, #"{"error":"List unavailable"}"#) }
        }
        await model.importWorkspace(value); try await eventually { model.sectionErrors[.watchlist] != nil }
        #expect(model.watchlist == ["MSFT", "SPY"] && model.workspaceImportError == nil && model.workspaceImportMessage == "Watchlist imported.")
        #expect(!model.importingWorkspace && !model.managingLists)
    }

    @Test(arguments: [200, 401]) func importingTheSameSymbolsStillInvalidatesAPreImportRead(status: Int) async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        model.workspaces = [try source(["AAPL"])]; let value = try plan(model), old = ImportGate(), latest = ImportGate()
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/watchlists" {
                if requests.all.filter({ $0.url?.path == "/api/watchlists" }).count == 1 { old.hold(request) } else { latest.hold(request) }
            } else { request.fixture() }
        }
        let refresh = Task { await model.refresh() }; try await eventually { old.waiting }
        await model.importWorkspace(value); try await eventually { latest.waiting }
        if status == 200 { old.releaseLists(symbols: ["TSLA"], version: 1) } else { old.release(status, "") }
        await refresh.value
        #expect(model.signedIn && model.error == nil && model.watchlist == ["AAPL"] && model.sharedLists.first?.version == 2)
        latest.releaseLists(symbols: ["AAPL"], version: 2); try await refreshed(model)
    }

    @Test func conflictRefreshesTheTargetWithoutRetryingUntilAnotherReview() async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model)
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "PUT" { request.respond(409, #"{"error":"This watchlist changed. Refresh before replacing it."}"#) }
            else if request.request.url?.path == "/api/watchlists" { request.lists(symbols: ["AAPL", "GOOG"], version: 2) }
            else { request.fixture() }
        }
        await model.importWorkspace(value); try await refreshed(model)
        #expect(model.workspaceImportError != nil && model.workspaceImportMessage == nil && model.watchlist == ["AAPL", "GOOG"] && !model.reconnecting)
        await model.importWorkspace(value); #expect(requests.all.filter { $0.httpMethod == "PUT" }.count == 1)
        let reviewed = try plan(model); #expect(reviewed.target.version == 2)
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/watchlists" { request.lists(symbols: ["MSFT", "SPY"], version: 3) } else { request.fixture() }
        }
        await model.importWorkspace(reviewed)
        try await eventually { requests.all.filter { $0.url?.path == "/api/briefings/current" }.count == 2 }; try await refreshed(model)
        #expect(model.workspaceImportError == nil && model.watchlist == ["MSFT", "SPY"] && model.sharedLists.first?.version == 3)
        let post = try #require(requests.all.last { $0.httpMethod == "PUT" })
        #expect(ImportProtocol.body(post)?["version"] as? Int == 2)
    }

    @Test func invalidSourcesAreRejectedWhileDuplicatesAndExplicitEmptyImportsAreSupported() async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        for symbols in [["not a ticker"], (0...150).map { "SYM\($0)" }] {
            model.workspaces = [try source(symbols)]
            #expect(model.prepareWorkspaceImport(model.workspaces[0]) == nil && model.workspaceImportError != nil)
        }
        model.workspaces = [try source(Array(repeating: " aapl ", count: 200))]
        #expect(try plan(model).symbols == ["AAPL"])
        model.workspaces = [try source([])]; let empty = try plan(model); #expect(empty.symbols.isEmpty)
        #expect(requests.all.isEmpty)
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/watchlists" { request.lists(symbols: [], version: 2) } else { request.fixture() }
        }
        await model.importWorkspace(empty); try await refreshed(model)
        #expect(model.watchlist.isEmpty && model.sharedListID == 1 && model.sharedLists.first?.payload.symbols == [])
        model.sharedListID = nil; #expect(model.prepareWorkspaceImport(empty.workspace) == nil)
        #expect(model.workspaceImportError?.contains("Choose a shared watchlist") == true)
    }

    @Test func failedAndCanceledWritesKeepTheTargetWithoutAutomaticRetry() async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model)
        ImportProtocol.handler = { request in requests.append(request.request); request.respond(503, #"{"error":"Retry later"}"#) }
        await model.importWorkspace(value)
        #expect(model.workspaceImportError != nil && model.watchlist == ["AAPL"] && !model.importingWorkspace && !model.managingLists && requests.all.count == 1)
        let write = ImportGate()
        ImportProtocol.handler = { request in requests.append(request.request); write.hold(request) }
        let action = Task { await model.importWorkspace(value) }; try await eventually { write.waiting }
        action.cancel(); await action.value
        #expect(model.workspaceImportError == nil && model.workspaceImportMessage == nil && model.watchlist == ["AAPL"] && requests.all.count == 2)
        #expect(!model.importingWorkspace && !model.managingLists)
        write.release(200, #"{"ok":true}"#)
        let canceled = Task { await Task.yield(); await model.importWorkspace(value) }; canceled.cancel(); await canceled.value
        #expect(requests.all.count == 2)
    }

    @Test(arguments: [200, 401]) func oldImportAndConfirmationCannotChangeANewerConnectionsPendingImport(status: Int) async throws {
        let (model, requests) = try await fixture(); defer { ImportProtocol.handler = nil }
        let oldPlan = try plan(model), old = ImportGate(), logout = ImportGate(), latest = ImportGate()
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.httpMethod == "PUT" && request.request.url?.path.hasPrefix("/api/watchlists/") == true { latest.hold(request) }
            else { request.fixture() }
        }
        let action = Task { await model.importWorkspace(oldPlan) }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(!model.importingWorkspace && !model.managingLists && model.workspaceImportError == nil && !model.workspacesLoaded)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true); installLists(model)
        await model.loadWorkspaces(session: model.sessionID)
        await model.importWorkspace(oldPlan); #expect(!latest.waiting)
        let current = try plan(model), next = Task { await model.importWorkspace(current) }; try await eventually { latest.waiting }
        old.release(status, #"{"ok":true}"#); await action.value
        #expect(model.signedIn && model.server?.origin.host == "second.example.com" && model.error == nil)
        #expect(model.importingWorkspace && model.managingLists && model.workspaceImportError == nil && model.workspaceImportMessage == nil && model.watchlist == ["AAPL"])
        logout.release(200, #"{"ok":true}"#); await signOut.value
        ImportProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/watchlists" { request.lists(symbols: ["MSFT", "SPY"], version: 2) } else { request.fixture() }
        }
        latest.release(200, #"{"ok":true}"#); await next.value; try await refreshed(model)
        #expect(!model.importingWorkspace && !model.managingLists && model.watchlist == ["MSFT", "SPY"])
    }

    @Test(arguments: [200, 401]) func aNewerPublishedLayoutLoadWinsOverAnOlderResponse(status: Int) async throws {
        let (model, _) = try await fixture(); defer { ImportProtocol.handler = nil }
        let old = ImportGate(), session = model.sessionID
        ImportProtocol.handler = { old.hold($0) }
        let first = Task { await model.loadWorkspaces(session: session) }; try await eventually { old.waiting }
        ImportProtocol.handler = { $0.sourcePage(symbols: ["NVDA"]) }; await model.loadWorkspaces(session: session)
        if status == 200 { old.releaseSource() } else { old.release(status, "") }; await first.value
        #expect(model.workspaces.first?.watchlist == ["NVDA"] && model.workspaceLoadError == nil && model.signedIn && !model.loadingWorkspaces)
    }

    @Test func sourceReadFailuresKeepCachedLayoutsAndNullSnapshotIsAnExplicitEmptyResult() async throws {
        let (model, _) = try await fixture(); defer { ImportProtocol.handler = nil }
        let before = model.workspaces
        ImportProtocol.handler = { $0.respond(503, #"{"error":"Layouts unavailable"}"#) }; await model.loadWorkspaces(session: model.sessionID)
        #expect(model.workspaces == before && model.workspaceLoadError != nil && !model.loadingWorkspaces && model.error == nil && !model.reconnecting)
        ImportProtocol.handler = { $0.respond(200, "null") }; await model.loadWorkspaces(session: model.sessionID)
        #expect(model.workspaces.isEmpty && model.workspacesLoaded && model.workspaceLoadError == nil)
    }

    @Test(arguments: ["GET", "PUT"]) func currentUnauthorizedOperationClearsAllImportState(method: String) async throws {
        let (model, _) = try await fixture(); defer { ImportProtocol.handler = nil }
        let value = try plan(model)
        ImportProtocol.handler = { request in
            if request.request.httpMethod == "DELETE" { request.fixture() } else { request.respond(401, "") }
        }
        if method == "GET" { await model.loadWorkspaces(session: model.sessionID) } else { await model.importWorkspace(value) }
        #expect(!model.signedIn && model.error != nil && model.workspaces.isEmpty && !model.workspacesLoaded)
        #expect(!model.loadingWorkspaces && !model.importingWorkspace && !model.managingLists && model.workspaceLoadError == nil && model.workspaceImportError == nil)
    }
}

@MainActor private final class ImportCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-workspace-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class ImportDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
}
private final class ImportRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { values } }
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func clear() { lock.withLock { values = [] } }
}
private final class ImportGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: ImportProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: ImportProtocol) { lock.withLock { held = value } }
    private func take() -> ImportProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func releaseLists(symbols: [String], version: Int) { take()?.lists(symbols: symbols, version: version) }
    func releaseSource() { take()?.sourcePage() }
}
private final class ImportProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (ImportProtocol) -> Void)?
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
        else if request.url?.path == "/api/mobile/session" { respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if request.httpMethod == "PUT" { respond(200, #"{"ok":true}"#) }
        else if request.url?.path == "/api/sync" { sourcePage() }
        else if request.url?.path == "/api/watchlists" { lists(symbols: ["AAPL"], version: 1) }
        else if request.url?.path == "/api/quotes" { respond(200, "[]") }
        else if request.url?.path == "/api/portfolios" { respond(200, "[]") }
        else if request.url?.path == "/api/alerts" { respond(200, #"{"alerts":[]}"#) }
        else if request.url?.path == "/api/briefings/current" { respond(200, #"{"date":"2026-01-01","summary":"Ready","indexes":[],"headlines":[],"warnings":[]}"#) }
        else { respond(404, #"{"error":"Unexpected import fixture"}"#) }
    }
    static func listJSON(symbols: [String] = ["AAPL"], version: Int = 1) -> String {
        let rows: [[String: Any]] = [["id": 1, "version": version, "payload": ["name": "One", "symbols": symbols]], ["id": 2, "version": 3, "payload": ["name": "Two", "symbols": ["TSLA"]]]]
        return String(decoding: try! JSONSerialization.data(withJSONObject: rows), as: UTF8.self)
    }
    func lists(symbols: [String], version: Int) { respond(200, Self.listJSON(symbols: symbols, version: version)) }
    func sourcePage(symbols: [String] = [" msft ", "SPY", "msft"]) {
        let data = try! JSONSerialization.data(withJSONObject: ["payload": ["workspace": ["workspaces": [["id": "layout", "name": "Desk", "watchlist": symbols]]]]])
        respond(200, String(decoding: data, as: UTF8.self))
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
