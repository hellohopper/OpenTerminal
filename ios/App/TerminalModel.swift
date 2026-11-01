import Foundation
import SwiftUI
import OpenTerminalCore

enum TerminalTab: String, CaseIterable { case today, watchlist, holdings, alerts }

struct WatchlistCreationPlan: Sendable {
    let name: String; let symbols: [String]; let session: UUID; let selection: UUID
}
@MainActor final class WatchlistNameDraft: ObservableObject {
    @Published var text = "" { didSet { if text != oldValue { revision += 1 } } }
    @Published private(set) var creating = false
    private(set) var revision = 0
    private var acknowledgedRevision = -1
    func begin(_ revision: Int) -> Bool {
        guard !creating, revision > acknowledgedRevision else { return false }; creating = true; return true
    }
    func finish(_ revision: Int, acknowledged: Bool) {
        if acknowledged {
            acknowledgedRevision = max(acknowledgedRevision, revision)
            if self.revision == revision { text = "" }
        }
        creating = false
    }
    func clear() { text = ""; creating = false; acknowledgedRevision = -1 }
}
private enum WatchlistMutation: Sendable {
    case created(SharedWatchlist, selection: UUID), updated(SharedWatchlist), removed(SharedWatchlist)
    case ordered([SharedWatchlist], baseline: [SharedWatchlist], observation: UUID)
}

enum WatchlistSymbolAction: String { case add, remove }
struct WatchlistSymbolKey: Hashable { let listID: Int; let symbol: String }
struct WatchlistSymbolFailure { let action: WatchlistSymbolAction; let message: String }
@MainActor final class WatchlistSymbolEntry: ObservableObject {
    let listID: Int; let session: UUID
    @Published var text = "" { didSet { if text != oldValue { revision += 1; error = nil; message = nil } } }
    @Published var saving = false
    @Published var error: String?
    @Published var message: String?
    private(set) var revision = 0
    init(listID: Int, session: UUID) { self.listID = listID; self.session = session }
    func clear() { text = ""; saving = false; error = nil; message = nil }
}

struct WatchlistImportPlan {
    let workspace: SharedWorkspace
    let target: SharedWatchlist
    let session: UUID
    let symbols: [String]
    init?(workspace: SharedWorkspace, target: SharedWatchlist, session: UUID) {
        var symbols: [String] = [], seen = Set<String>()
        for raw in workspace.watchlist {
            guard let symbol = normalizedSymbol(raw) else { return nil }
            if seen.insert(symbol).inserted { symbols.append(symbol) }
        }
        guard symbols.count <= 150, target.id > 0, target.version > 0, target.version < Int.max else { return nil }
        self.workspace = workspace; self.target = target; self.session = session; self.symbols = symbols
    }
}

@MainActor final class TerminalModel: ObservableObject, ResearchNotificationConsumer {
    @Published var serverText: String {
        didSet {
            // Whitespace and a trailing slash do not change the canonical origin.
            guard (try? ServerConnection(serverText)) != (try? ServerConnection(oldValue)) else { return }
            invalidateAuthentication(); restoreAttempted = false; error = nil
            pendingResearch = nil; researchSymbol = nil
        }
    }
    @Published var signedIn = false
    @Published var busy = false
    @Published var restoring = true
    @Published var rememberDevice = true
    @Published var deviceName = "My iPhone"
    @Published var error: String?
    @Published var lastUpdated: Date?
    @Published var sectionErrors: [DataSection: String] = [:]
    @Published var sectionUpdated: [DataSection: Date] = [:]
    @Published var loadingSections: Set<DataSection> = []
    @Published private(set) var health: [String: String] = [:]
    @Published private(set) var healthReceivedAt: [String: Date] = [:]
    @Published private(set) var healthErrors: [String: String] = [:]
    @Published private(set) var checkingHealth = false
    private var healthRequest: UUID?
    @Published var reconnecting = false
    @Published var pushMessage: String?
    @Published private(set) var registeringPush = false
    @Published var devices: [MobileDeviceInfo] = []
    @Published private(set) var loadingDevices = false
    @Published private(set) var deviceListError: String?
    @Published private(set) var pendingDeviceRevocations: Set<String> = []
    @Published private(set) var deviceActionErrors: [String: String] = [:]
    var currentDeviceID: String? { credential?.id }
    @Published var sharedLists: [SharedWatchlist] = []
    @Published var sharedListID: Int? { didSet { if sharedListID != oldValue { listSelection = UUID() } } }
    private(set) var listSelection = UUID()
    @Published var managingLists = false
    @Published private(set) var loadingSharedLists = false
    @Published private(set) var sharedListReadError: String?
    @Published private(set) var listManagementMessage: String?
    @Published private(set) var listNameDraft = WatchlistNameDraft()
    private var listReadRequest: UUID?
    private var listObservation = UUID()
    private var removedSharedListIDs: Set<Int> = []
    private var listManagementRefresh: Task<Void, Never>?
    @Published private(set) var pendingSymbolChanges: Set<WatchlistSymbolKey> = []
    @Published private(set) var symbolChangeErrors: [WatchlistSymbolKey: WatchlistSymbolFailure] = [:]
    var listWritesBusy: Bool { managingLists || !pendingSymbolChanges.isEmpty }
    private var symbolEntries: [Int: WatchlistSymbolEntry] = [:]
    private var symbolReconcile: Task<Void, Never>?
    @Published var listManagementError: String? { didSet { if listManagementError != nil { listManagementMessage = nil } } }
    @Published var researchSymbol: String?
    @Published var quotes: [Quote] = []
    @Published var portfolios: [Portfolio] = []
    @Published private(set) var portfolioID: Int? {
        didSet {
            guard portfolioID != oldValue else { return }
            positions = []; holdingQuotes = []; holdingsReady = false
            sectionUpdated[.holdings] = nil; sectionErrors[.holdings] = nil; sectionRequests[.holdings] = UUID()
            saveViewChoice(portfolioID.map { String($0) }, field: "portfolio")
        }
    }
    @Published var selectedTab: TerminalTab = .today {
        didSet { saveViewChoice(selectedTab.rawValue, field: "tab") }
    }
    static let chartRanges = ["1M", "6M", "1Y", "5Y"]
    private(set) var preferredChartRange = "6M"
    @Published var positions: [Position] = []
    @Published var holdingQuotes: [Quote] = []
    @Published var holdingsReady = false
    @Published var alerts: [AlertRule] = []
    @Published private(set) var alertMonitor: AlertMonitor?
    @Published private(set) var alertMonitorReceivedAt: Date?
    @Published private(set) var pendingAlertActions: Set<Int> = []
    @Published private(set) var alertActionErrors: [Int: String] = [:]
    @Published private(set) var alertEditor = AlertEditorState()
    private var alertEdits: [Int: AlertEditState] = [:]
    @Published var briefing: Briefing?
    @Published var workspaces: [SharedWorkspace] = []
    @Published private(set) var loadingWorkspaces = false
    @Published private(set) var workspacesLoaded = false
    @Published private(set) var workspaceLoadError: String?
    @Published private(set) var importingWorkspace = false
    @Published private(set) var workspaceImportError: String?
    @Published private(set) var workspaceImportMessage: String?
    @Published var watchlist: [String] = []
    private(set) var api: TerminalAPI?
    private(set) var server: ServerConnection?
    private var generation = UUID()
    var sessionID: UUID { generation }
    var researchDrafts: [String: ResearchDraft] = [:]
    var researchNoteStates: [String: ResearchNoteState] = [:]
    private var refreshID: UUID?
    private var selectionRefresh: Task<Void, Never>?
    private var portfolioRefresh: Task<Void, Never>?
    private var alertRefresh: Task<Void, Never>?
    private var deviceRefresh: Task<Void, Never>?
    private var deviceListRequest: UUID?
    private var workspaceLoadRequest: UUID?
    private var workspaceImportRefresh: Task<Void, Never>?
    private var sectionRequests: [DataSection: UUID] = [:]
    private let defaults: UserDefaults
    private let credentials: any CredentialStorage
    private let makeClient: (ServerConnection, MobileCredential?) -> TerminalAPI
    private var listRevision = 0
    private var credential: MobileCredential?
    private var renewedAt = Date.now
    private var restoreAttempted = false
    private var authenticationID: UUID?
    private var authenticationServer: String?
    private var pushOperation: UUID?
    private var pendingResearch: NotificationResearchTarget?
    private let notifications: any NativeNotificationAccess
    var retryDelay: Double = 2
    var valuation: HoldingValuation? { holdingsReady ? HoldingValuation(positions: positions, quotes: holdingQuotes) : nil }
    var selectedPortfolio: Portfolio? { portfolios.first { $0.id == portfolioID } }

    init(defaults: UserDefaults = .standard, credentials: any CredentialStorage = KeychainCredentialStorage(),
         notifications: any NativeNotificationAccess = SystemNotificationAccess(),
         notificationInbox: ResearchNotificationInbox = .shared,
         makeClient: @escaping (ServerConnection, MobileCredential?) -> TerminalAPI = { TerminalAPI(server: $0, credential: $1) }) {
        self.defaults = defaults; self.credentials = credentials; self.notifications = notifications; self.makeClient = makeClient
        serverText = defaults.string(forKey: "server") ?? ""
        notificationInbox.attach(self)
    }

    func receiveNotification(_ target: NotificationResearchTarget) {
        pendingResearch = nil // A newer tap must not revive an earlier queued navigation.
        if signedIn {
            guard let server, target.matches(server), target.deviceID == credential?.id.lowercased() else { return }
            researchSymbol = target.symbol
        } else if let selected = try? ServerConnection(serverText), target.matches(selected) {
            pendingResearch = target
        }
    }
    private func openPendingResearch() {
        if let target = pendingResearch { pendingResearch = nil; receiveNotification(target) }
    }

    private func saveViewChoice(_ value: String?, field: String) {
        guard signedIn, let server else { return }
        defaults.set(value, forKey: "ios-view:\(server.origin.absoluteString):\(field)")
    }
    private func restoreViewChoices(at connection: ServerConnection) {
        let prefix = "ios-view:\(connection.origin.absoluteString):"
        selectedTab = defaults.string(forKey: prefix + "tab").flatMap(TerminalTab.init(rawValue:)) ?? .today
        let savedID = defaults.string(forKey: prefix + "portfolio").flatMap(Int.init)
        portfolioID = savedID.flatMap { $0 > 0 ? $0 : nil }
        let range = defaults.string(forKey: prefix + "range") ?? "6M"
        preferredChartRange = Self.chartRanges.contains(range) ? range : "6M"
    }
    func rememberChartRange(_ range: String) {
        guard signedIn, Self.chartRanges.contains(range) else { return }
        preferredChartRange = range; saveViewChoice(range, field: "range")
    }
    func choosePortfolio(_ id: Int?) {
        guard signedIn, id != portfolioID, portfolios.contains(where: { $0.id == id }) else { return }
        portfolioID = id; portfolioRefresh?.cancel()
        let token = generation
        portfolioRefresh = Task {
            guard token == generation, !Task.isCancelled else { return }
            await refreshHoldings()
        }
    }

    private func persist(_ value: MobileCredential, at connection: ServerConnection) throws {
        if rememberDevice { try credentials.save(JSONEncoder().encode(value), server: connection.origin.absoluteString) }
        else { credentials.remove(connection.origin.absoluteString) }
    }
    private func invalidateAuthentication() {
        authenticationID = nil; authenticationServer = nil; busy = false; restoring = false
    }
    private func finishAuthentication(_ operation: UUID) {
        if authenticationID == operation { invalidateAuthentication() }
    }
    private func acceptsAuthentication(_ operation: UUID) -> Bool {
        authenticationID == operation && !Task.isCancelled
    }
    func signIn(password: String) async {
        guard !busy, !signedIn else { return }
        let operation = UUID(); authenticationID = operation; authenticationServer = nil
        busy = true; restoring = false; error = nil
        defer { finishAuthentication(operation) }
        do {
            let connection = try ServerConnection(serverText), client = makeClient(connection, nil)
            authenticationServer = connection.origin.absoluteString
            let value = try await client.pair(password: password, name: deviceName)
            // A late pairing created a new token; try to revoke it without touching a newer session.
            guard acceptsAuthentication(operation) else { await client.signOut(); return }
            do { try persist(value, at: connection) } catch { await client.signOut(); throw error }
            guard acceptsAuthentication(operation) else { return }
            credential = value; renewedAt = .now; generation = UUID(); api = client; server = connection
            restoreViewChoices(at: connection); signedIn = true
            defaults.set(connection.origin.absoluteString, forKey: "server")
            openPendingResearch()
        } catch { if acceptsAuthentication(operation), !(error is CancellationError) { self.error = error.localizedDescription } }
    }
    func restoreSession(force: Bool = false) async {
        guard !signedIn, !busy, authenticationID == nil, force || !restoreAttempted else { return }
        restoreAttempted = true
        let operation = UUID(); authenticationID = operation; restoring = true; error = nil
        defer { finishAuthentication(operation) }
        var connection: ServerConnection?
        do {
            let target = try ServerConnection(serverText); connection = target
            guard let data = try credentials.load(target.origin.absoluteString) else {
                if force { error = nativeText("No saved device authorization for this server. Sign in once to pair it.") }; return
            }
            let value = try JSONDecoder().decode(MobileCredential.self, from: data)
            authenticationServer = target.origin.absoluteString
            let client = makeClient(target, value), fresh = try await client.renewDevice()
            // Restoring reuses an existing token: an obsolete response must neither save nor revoke it.
            guard acceptsAuthentication(operation) else { return }
            try persist(fresh, at: target)
            api = client; server = target; credential = fresh; renewedAt = .now; generation = UUID()
            restoreViewChoices(at: target); signedIn = true
            defaults.set(target.origin.absoluteString, forKey: "server")
            openPendingResearch()
        } catch ConnectionError.invalidServer { }
        catch {
            guard acceptsAuthentication(operation), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized, let connection { credentials.remove(connection.origin.absoluteString) }
            self.error = error.localizedDescription
        }
    }
    func signOut() async {
        let old = api, pendingServer = authenticationServer
        invalidateAuthentication(); restoreAttempted = true
        if let server { credentials.remove(server.origin.absoluteString) }
        if let pendingServer { credentials.remove(pendingServer) }
        generation = UUID(); credential = nil; api = nil; server = nil; signedIn = false
        for state in researchNoteStates.values { state.clear() }
        researchDrafts = [:]; researchNoteStates = [:]; pendingResearch = nil; researchSymbol = nil
        alertEditor.clear(); alertEditor = AlertEditorState(); alertRefresh?.cancel(); alertRefresh = nil
        for state in alertEdits.values { state.clear() }; alertEdits = [:]
        pendingAlertActions = []; alertActionErrors = [:]
        workspaceImportRefresh?.cancel(); workspaceImportRefresh = nil; workspaceLoadRequest = nil
        loadingWorkspaces = false; workspacesLoaded = false; workspaceLoadError = nil
        importingWorkspace = false; workspaceImportError = nil; workspaceImportMessage = nil
        deviceRefresh?.cancel(); deviceRefresh = nil; deviceListRequest = nil
        loadingDevices = false; deviceListError = nil; pendingDeviceRevocations = []; deviceActionErrors = [:]
        selectionRefresh?.cancel(); selectionRefresh = nil; sectionRequests = [:]
        portfolioRefresh?.cancel(); portfolioRefresh = nil; selectedTab = .today; preferredChartRange = "6M"
        quotes = []; portfolios = []; positions = []; holdingQuotes = []; alerts = []; alertMonitor = nil; alertMonitorReceivedAt = nil; briefing = nil; workspaces = []; portfolioID = nil; holdingsReady = false
        sharedLists = []; sharedListID = nil; devices = []; watchlist = []; lastUpdated = nil; reconnecting = false; error = nil
        managingLists = false; listManagementError = nil
        listNameDraft.clear(); listNameDraft = WatchlistNameDraft(); listManagementMessage = nil
        loadingSharedLists = false; sharedListReadError = nil; listReadRequest = nil; listObservation = UUID(); removedSharedListIDs = []
        listManagementRefresh?.cancel(); listManagementRefresh = nil
        for entry in symbolEntries.values { entry.clear() }; symbolEntries = [:]
        pendingSymbolChanges = []; symbolChangeErrors = [:]; symbolReconcile?.cancel(); symbolReconcile = nil
        pushOperation = nil; registeringPush = false; pushMessage = nil
        refreshID = nil; sectionErrors = [:]; sectionUpdated = [:]; loadingSections = []
        health = [:]; healthReceivedAt = [:]; healthErrors = [:]; healthRequest = nil; checkingHealth = false
        await old?.signOut()
    }
    func report(_ error: Error, section: DataSection? = nil) async {
        if error is CancellationError { return }
        if error as? ConnectionError == .unauthorized {
            await signOut()
            if !signedIn { self.error = error.localizedDescription }
            return
        }
        reconnecting = true; retryDelay = min(30, max(2, retryDelay * 2))
        if let section, signedIn { sectionErrors[section] = error.localizedDescription }
        else { self.error = error.localizedDescription }
    }
    func refresh() async {
        guard let api, refreshID == nil else { return }; let operation = UUID(); refreshID = operation
        defer { if refreshID == operation { refreshID = nil } }
        let token = generation; error = nil
        do {
            if Date.now.timeIntervalSince(renewedAt) > 86400 {
                let value = try await api.renewDevice(); guard token == generation else { return }
                credential = value; renewedAt = .now; if let server { try persist(value, at: server) }
            }
            async let lists: Void = refreshWatchlistData()
            async let accounts: Void = refreshAccounts()
            async let rules: Bool = refreshAlerts()
            _ = await (lists, accounts, rules)
            if token == generation && !Task.isCancelled && self.error == nil && sectionErrors.isEmpty { lastUpdated = .now; reconnecting = false; retryDelay = 2 }
        } catch { if token == generation && !Task.isCancelled { await report(error) } }
    }
    private func begin(_ section: DataSection) -> UUID {
        let request = UUID(); sectionRequests[section] = request
        loadingSections.insert(section); sectionErrors[section] = nil; return request
    }
    private func current(_ section: DataSection, request: UUID, token: UUID) -> Bool {
        token == generation && sectionRequests[section] == request && !Task.isCancelled
    }
    private func finish(_ section: DataSection, request: UUID, token: UUID) {
        if token == generation && sectionRequests[section] == request { loadingSections.remove(section) }
    }
    private func refreshWatchlistData() async {
        guard signedIn, api != nil, !Task.isCancelled else { return }
        let token = generation, revision = listRevision, pricesRequest = begin(.watchlist), briefingRequest = begin(.briefing)
        let listRequest = beginListRead()
        defer { finish(.watchlist, request: pricesRequest, token: token); finish(.briefing, request: briefingRequest, token: token) }
        do {
            let loaded = try await readSharedLists(listRequest); guard loaded, token == generation, revision == listRevision, listReadRequest == listRequest, !Task.isCancelled else { return }
            async let prices: Void = refreshQuotes()
            async let summary: Void = refreshBriefing()
            _ = await (prices, summary)
        } catch { if listReadRequest == listRequest && revision == listRevision && current(.watchlist, request: pricesRequest, token: token) {
            await report(error, section: .watchlist)
            if current(.briefing, request: briefingRequest, token: token) && !(error is CancellationError) { sectionErrors[.briefing] = nativeText("Briefing could not refresh because the shared watchlist is unavailable.") }
        } }
    }
    private func refreshAccounts() async {
        guard let api else { return }; let token = generation, request = begin(.holdings); defer { finish(.holdings, request: request, token: token) }
        do {
            let accounts: [Portfolio] = try await api.get("/api/portfolios")
            guard current(.holdings, request: request, token: token) else { return }; portfolios = accounts
            if !accounts.contains(where: { $0.id == portfolioID }) { portfolioID = accounts.first?.id }
            await refreshHoldings()
        } catch { if current(.holdings, request: request, token: token) { await report(error, section: .holdings) } }
    }
    @discardableResult func refreshAlerts() async -> Bool {
        guard let api else { return false }; let token = generation, request = begin(.alerts); defer { finish(.alerts, request: request, token: token) }
        do {
            let rules: AlertList = try await api.get("/api/alerts")
            if current(.alerts, request: request, token: token) {
                let received = Date.now
                alerts = rules.alerts; alertMonitor = rules.monitor; alertMonitorReceivedAt = rules.monitor == nil ? nil : received
                sectionUpdated[.alerts] = received
                return true
            }
        } catch { if current(.alerts, request: request, token: token) { await report(error, section: .alerts) } }
        return false
    }
    func refreshQuotes() async {
        guard let api else { return }; let token = generation, symbols = watchlist
        let request = begin(.watchlist); defer { finish(.watchlist, request: request, token: token) }
        if symbols.isEmpty { quotes = []; sectionUpdated[.watchlist] = .now; return }
        do { let rows: [Quote] = try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")]); if current(.watchlist, request: request, token: token) && symbols == watchlist { quotes = rows; sectionUpdated[.watchlist] = .now } }
        catch { if current(.watchlist, request: request, token: token) && symbols == watchlist { await report(error, section: .watchlist) } }
    }
    func refreshHoldings() async {
        guard let api else { return }; let token = generation, request = begin(.holdings); defer { finish(.holdings, request: request, token: token) }
        guard let id = portfolioID else { holdingsReady = false; positions = []; holdingQuotes = []; sectionUpdated[.holdings] = .now; return }; holdingsReady = false
        do {
            let rows: [Position] = try await api.get("/api/portfolios/\(id)/positions"), symbols = rows.map(\.symbol)
            let prices: [Quote] = symbols.isEmpty ? [] : try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")])
            guard current(.holdings, request: request, token: token) && id == portfolioID else { return }; positions = rows; holdingQuotes = prices; holdingsReady = true; sectionUpdated[.holdings] = .now
        } catch { if current(.holdings, request: request, token: token) && id == portfolioID { await report(error, section: .holdings) } }
    }
    func refreshBriefing() async {
        guard let api else { return }; let token = generation, symbols = Array(watchlist.prefix(12)), request = begin(.briefing); defer { finish(.briefing, request: request, token: token) }
        if symbols.isEmpty { briefing = nil; sectionUpdated[.briefing] = .now; return }
        do { let result: Briefing = try await api.get("/api/briefings/current", query: ["symbols": symbols.joined(separator: ","), "mode": "pre-market"]); if current(.briefing, request: request, token: token) && symbols == Array(watchlist.prefix(12)) { briefing = result; sectionUpdated[.briefing] = .now } }
        catch { if current(.briefing, request: request, token: token) && symbols == Array(watchlist.prefix(12)) { await report(error, section: .briefing) } }
    }
    private func setWatchlist(_ symbols: [String]) {
        if watchlist != symbols {
            watchlist = symbols; quotes = []; briefing = nil
            for section in [DataSection.watchlist, .briefing] { sectionRequests[section] = UUID(); loadingSections.remove(section); sectionUpdated[section] = nil; sectionErrors[section] = nil }
        }
    }
    @discardableResult func refreshLists() async throws -> Bool {
        guard signedIn, api != nil, !Task.isCancelled else { return false }
        return try await readSharedLists(beginListRead())
    }
    private func beginListRead() -> UUID {
        let request = UUID()
        listReadRequest = request; loadingSharedLists = true; sharedListReadError = nil
        return request
    }
    private func readSharedLists(_ request: UUID, initialize: Bool = true) async throws -> Bool {
        let token = generation
        defer { if token == generation, listReadRequest == request { loadingSharedLists = false } }
        guard signedIn, let api, !Task.isCancelled, listReadRequest == request else { return false }
        let revision = listRevision
        func accepts() -> Bool { token == generation && revision == listRevision && listReadRequest == request && !Task.isCancelled }
        do {
            var lists: [SharedWatchlist] = try await api.get("/api/watchlists")
            guard accepts() else { return false }
            if lists.isEmpty && initialize {
                let legacy = server.flatMap { defaults.stringArray(forKey: "watchlist:\($0.origin.absoluteString)") } ?? ["AAPL", "MSFT", "NVDA", "SPY"]
                let _: Acknowledgement = try await api.post("/api/watchlists/default", body: NewList(name: "My watchlist", symbols: legacy.compactMap(normalizedSymbol)))
                guard accepts() else { return false }
                lists = try await api.get("/api/watchlists")
            }
            guard accepts() else { return false }
            let ids = Set(lists.map(\.id))
            removedSharedListIDs.formUnion(Set(sharedLists.map(\.id)).subtracting(ids)); removedSharedListIDs.subtract(ids)
            sharedLists = lists; listObservation = UUID()
            let saved = server.map { defaults.integer(forKey: "shared-list:\($0.origin.absoluteString)") }
            synchronizeListSelection(preferred: sharedListID ?? saved)
            return true
        } catch {
            guard accepts(), !(error is CancellationError) else { return false }
            sharedListReadError = error.localizedDescription; throw error
        }
    }
    private func synchronizeListSelection(preferred: Int?) {
        let selected = sharedLists.first { $0.id == preferred } ?? sharedLists.first
        if sharedListID != selected?.id {
            sharedListID = selected?.id
            if let server { defaults.set(selected?.id ?? 0, forKey: "shared-list:\(server.origin.absoluteString)") }
        }
        setWatchlist(selected?.payload.symbols ?? [])
    }
    func reloadSharedLists(session: UUID) async {
        guard signedIn, session == generation, !Task.isCancelled else { return }
        let request = beginListRead()
        do { if try await readSharedLists(request, initialize: false), session == generation, listReadRequest == request, !Task.isCancelled { refreshSelection() } }
        catch { if session == generation, listReadRequest == request, !Task.isCancelled, error as? ConnectionError == .unauthorized { await report(error) } }
    }
    func chooseList(_ id: Int) {
        guard sharedLists.contains(where: { $0.id == id }) else { return }
        listRevision += 1
        sharedListID = id
        if let server { defaults.set(id, forKey: "shared-list:\(server.origin.absoluteString)") }
        if let row = sharedLists.first(where: { $0.id == id }) { setWatchlist(row.payload.symbols) }; refreshSelection()
    }
    private func refreshSelection() {
        selectionRefresh?.cancel()
        let token = generation
        selectionRefresh = Task {
            guard token == generation, !Task.isCancelled else { return }
            async let prices: Void = refreshQuotes()
            async let summary: Void = refreshBriefing()
            _ = await (prices, summary)
        }
    }
    @discardableResult func createList(name: String, copyCurrent: Bool = false) async -> Bool {
        let source = sharedLists.first { $0.id == sharedListID }
        guard !copyCurrent || source != nil, let plan = prepareListCreation(name: name, copying: copyCurrent ? source : nil, session: generation, selection: listSelection) else { return false }
        return await createList(plan)
    }
    func prepareListCreation(name: String, copying source: SharedWatchlist?, session: UUID, selection: UUID) -> WatchlistCreationPlan? {
        guard signedIn, session == generation, !listWritesBusy else { return nil }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines), symbols = source?.payload.symbols ?? []
        guard !name.isEmpty, name.utf16.count <= 64 else { listManagementError = nativeText("Use a name of 1–64 characters."); return nil }
        guard symbols.count <= 150, symbols.allSatisfy({ normalizedSymbol($0) == $0 }) else {
            listManagementError = nativeText("This watchlist cannot be copied. Refresh and try again."); return nil
        }
        return WatchlistCreationPlan(name: name, symbols: symbols, session: session, selection: selection)
    }
    @discardableResult func createList(_ plan: WatchlistCreationPlan) async -> Bool {
        await manageLists(session: plan.session, message: "Watchlist created.") { api in
            let result: CreatedList = try await api.post("/api/watchlists", body: NewList(name: plan.name, symbols: plan.symbols))
            return .created(SharedWatchlist(id: result.id, version: 1, name: plan.name, symbols: plan.symbols), selection: plan.selection)
        }
    }
    @discardableResult func submitListCreation(_ plan: WatchlistCreationPlan, draft: WatchlistNameDraft, revision: Int) async -> Bool {
        guard signedIn, plan.session == generation, draft === listNameDraft, draft.begin(revision) else { return false }
        let acknowledged = await createList(plan)
        guard plan.session == generation, draft === listNameDraft else { return false }
        draft.finish(revision, acknowledged: acknowledged)
        return acknowledged
    }
    @discardableResult func renameList(_ row: SharedWatchlist, name: String, session: UUID? = nil) async -> Bool {
        let session = session ?? generation
        guard signedIn, session == generation, !Task.isCancelled else { return false }
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf16.count <= 64 else { listManagementError = nativeText("Use a name of 1–64 characters."); return false }
        guard reviewedList(row) else { return false }
        return await manageLists(session: session, message: "Watchlist renamed.") { api in
            let updated: SharedWatchlist = try await api.post("/api/watchlists/\(row.id)/rename", body: RenamedList(name: name, version: row.version))
            guard updated.id == row.id else { throw ConnectionError.response(502, nativeText("The watchlist response was unexpected. Refresh and try again.")) }
            return .updated(updated)
        }
    }
    @discardableResult func deleteList(_ row: SharedWatchlist, session: UUID? = nil) async -> Bool {
        let session = session ?? generation
        guard signedIn, session == generation, !Task.isCancelled, reviewedList(row) else { return false }
        return await manageLists(session: session, message: "Watchlist deleted.") { api in try await api.delete("/api/watchlists/\(row.id)", query: ["version": String(row.version)]); return .removed(row) }
    }
    func moveList(_ row: SharedWatchlist, direction: String, session: UUID? = nil) async {
        let session = session ?? generation
        guard signedIn, session == generation, !Task.isCancelled, ["up", "down"].contains(direction), reviewedList(row) else { return }
        let baseline = sharedLists, observation = listObservation
        await manageLists(session: session, message: "Watchlists reordered.") { api in
            let rows: [SharedWatchlist] = try await api.post("/api/watchlists/\(row.id)/move", body: ["direction": direction]); return .ordered(rows, baseline: baseline, observation: observation)
        }
    }
    func moveSymbol(_ symbol: String, direction: Int, in row: SharedWatchlist, session: UUID) async {
        guard signedIn, session == generation, !Task.isCancelled, !listWritesBusy, [-1, 1].contains(direction),
              let index = row.payload.symbols.firstIndex(of: symbol) else { return }
        guard sharedLists.first(where: { $0.id == row.id }) == row else {
            listManagementError = nativeText("This watchlist changed. Refresh and try again."); return
        }
        var symbols = row.payload.symbols; let next = index + direction
        guard symbols.indices.contains(next) else { return }; symbols.swapAt(index, next)
        await manageLists(session: session, message: "Symbols reordered.") { api in
            let updated: SharedWatchlist = try await api.post("/api/watchlists/\(row.id)/reorder-symbols", body: OrderedSymbols(symbols: symbols, version: row.version))
            guard updated.id == row.id else { throw ConnectionError.response(502, nativeText("The watchlist response was unexpected. Refresh and try again.")) }
            return .updated(updated)
        }
    }
    private func reviewedList(_ row: SharedWatchlist) -> Bool {
        guard sharedLists.first(where: { $0.id == row.id }) == row else { listManagementError = nativeText("This watchlist changed. Refresh and try again."); return false }
        return true
    }
    @discardableResult private func manageLists(session token: UUID, message: String, _ operation: (TerminalAPI) async throws -> WatchlistMutation) async -> Bool {
        guard signedIn, token == generation, let api, !listWritesBusy, !Task.isCancelled else { return false }
        listManagementRefresh?.cancel(); listReadRequest = nil; loadingSharedLists = false; sharedListReadError = nil
        managingLists = true; listManagementError = nil; listManagementMessage = nil; listRevision += 1
        defer { if token == generation { managingLists = false } }
        do {
            let result = try await operation(api); guard token == generation else { return false }
            listRevision += 1
            applyListMutation(result); listManagementMessage = nativeText(message)
            refreshSelection(); refreshAfterListMutation(session: token); return true
        } catch {
            guard token == generation, !Task.isCancelled, !(error is CancellationError) else { return false }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else {
                listManagementError = error.localizedDescription; listRevision += 1
                refreshAfterListMutation(session: token)
            }
            return false
        }
    }
    private func applyListMutation(_ result: WatchlistMutation) {
        var preferred = sharedListID
        switch result {
        case .created(let row, let selection):
            if !removedSharedListIDs.contains(row.id) {
                if !sharedLists.contains(where: { $0.id == row.id }) { sharedLists.append(row) }
                if listSelection == selection { preferred = row.id }
            }
        case .updated(let row):
            sharedLists = sharedLists.map { $0.id == row.id && $0.version <= row.version ? row : $0 }
        case .removed(let row):
            sharedLists.removeAll { $0 == row }
            if !sharedLists.contains(where: { $0.id == row.id }) { removedSharedListIDs.insert(row.id) }
        case .ordered(let rows, let baseline, let observation):
            let previous = sharedLists, ids = Set(rows.map(\.id))
            if observation != listObservation {
                // The order endpoint has no order version. A read accepted during the
                // write may be newer than its reply; keep that order until reconciliation.
                sharedLists = previous.map { current in rows.first { $0.id == current.id && $0.version > current.version } ?? current }
                sharedLists += rows.filter { row in !removedSharedListIDs.contains(row.id) && !previous.contains { $0.id == row.id } }
            } else {
                sharedLists = rows.filter { !removedSharedListIDs.contains($0.id) }.map { row in previous.first { $0.id == row.id && $0.version > row.version } ?? row }
                sharedLists += previous.filter { current in !ids.contains(current.id) && (baseline.first { $0.id == current.id }.map { current.version > $0.version } ?? true) }
            }
        }
        synchronizeListSelection(preferred: preferred)
    }
    private func refreshAfterListMutation(session: UUID) {
        listManagementRefresh?.cancel()
        let request = beginListRead(), revision = listRevision
        listManagementRefresh = Task {
            guard session == generation, listReadRequest == request, !Task.isCancelled else { return }
            do { if try await readSharedLists(request, initialize: false), session == generation, listReadRequest == request, revision == listRevision, !Task.isCancelled { refreshSelection() } }
            catch { if session == generation, listReadRequest == request, revision == listRevision, !Task.isCancelled, error as? ConnectionError == .unauthorized { await report(error) } }
        }
    }
    func symbolEntry(for listID: Int) -> WatchlistSymbolEntry? {
        guard signedIn, sharedLists.contains(where: { $0.id == listID }) else { return nil }
        if let entry = symbolEntries[listID] { return entry }
        let entry = WatchlistSymbolEntry(listID: listID, session: generation); symbolEntries[listID] = entry; return entry
    }
    private func currentEntry(_ entry: WatchlistSymbolEntry) -> Bool {
        signedIn && entry.session == generation && symbolEntries[entry.listID] === entry
    }
    func addSymbol(_ entry: WatchlistSymbolEntry) async {
        guard currentEntry(entry), !entry.saving, !Task.isCancelled else { return }
        guard let symbol = normalizedSymbol(entry.text) else { entry.error = nativeText("Enter a valid ticker."); return }
        let revision = entry.revision; entry.saving = true; entry.error = nil; entry.message = nil
        defer { if currentEntry(entry) { entry.saving = false } }
        let saved = await changeSymbol(symbol, action: .add, listID: entry.listID, session: entry.session)
        guard currentEntry(entry) else { return }
        if saved {
            if entry.revision == revision { entry.text = ""; entry.message = nativeText("Symbol added.") }
            else { entry.message = nativeText("Symbol added. Newer input is kept.") }
        } else if !Task.isCancelled {
            if entry.revision == revision {
                let key = WatchlistSymbolKey(listID: entry.listID, symbol: symbol)
                entry.error = symbolChangeErrors[key]?.message ?? nativeText("Wait for the current watchlist update to finish.")
            } else {
                entry.message = nativeText("Could not add %@. Your current input is kept.").replacingOccurrences(of: "%@", with: symbol)
            }
        }
    }
    @discardableResult func changeSymbol(_ symbol: String, action: WatchlistSymbolAction, listID: Int, session: UUID) async -> Bool {
        guard signedIn, session == generation, !Task.isCancelled, !managingLists, let value = normalizedSymbol(symbol), let api,
              sharedLists.contains(where: { $0.id == listID }) else { return false }
        let key = WatchlistSymbolKey(listID: listID, symbol: value)
        guard !pendingSymbolChanges.contains(key) else { return false }
        pendingSymbolChanges.insert(key); symbolChangeErrors[key] = nil; listRevision += 1
        defer { if session == generation { pendingSymbolChanges.remove(key) } }
        do {
            let row: SharedWatchlist = try await api.post("/api/watchlists/\(listID)/symbols", body: ["symbol": value, "action": action.rawValue])
            guard session == generation else { return false }
            guard row.id == listID else { throw ConnectionError.response(502, nativeText("The watchlist response was unexpected. Refresh and try again.")) }
            listRevision += 1
            if let current = sharedLists.first(where: { $0.id == listID }), current.version <= row.version {
                sharedLists = sharedLists.map { $0.id == listID ? row : $0 }
                if sharedListID == listID { setWatchlist(row.payload.symbols); refreshSelection() }
            }
            return true
        } catch {
            guard session == generation, !Task.isCancelled, !(error is CancellationError) else { return false }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else {
                symbolChangeErrors[key] = WatchlistSymbolFailure(action: action, message: error.localizedDescription)
                if case .response(let code, _) = error as? ConnectionError, code == 404 || code == 409 {
                    listRevision += 1; reconcileSymbolFailure(session: session)
                }
            }
            return false
        }
    }
    private func reconcileSymbolFailure(session: UUID) {
        symbolReconcile?.cancel()
        let request = beginListRead(), revision = listRevision
        symbolReconcile = Task {
            guard session == generation, listReadRequest == request, !Task.isCancelled else { return }
            do { if try await readSharedLists(request, initialize: false), session == generation, listReadRequest == request, revision == listRevision, !Task.isCancelled { refreshSelection() } }
            catch { if session == generation, listReadRequest == request, revision == listRevision, !Task.isCancelled, error as? ConnectionError == .unauthorized { await report(error) } }
        }
    }
    func prepareWorkspaceImport(_ workspace: SharedWorkspace) -> WatchlistImportPlan? {
        guard signedIn, !loadingWorkspaces, !importingWorkspace, !listWritesBusy else { return nil }
        workspaceImportError = nil; workspaceImportMessage = nil
        guard workspaces.contains(workspace) else { workspaceImportError = nativeText("The published layout changed. Load it again before importing."); return nil }
        guard let row = sharedLists.first(where: { $0.id == sharedListID }) else {
            workspaceImportError = nativeText("Choose a shared watchlist before importing a layout."); return nil
        }
        guard let plan = WatchlistImportPlan(workspace: workspace, target: row, session: generation) else {
            workspaceImportError = nativeText("Choose a layout with up to 150 valid symbols."); return nil
        }
        return plan
    }
    func importWorkspace(_ plan: WatchlistImportPlan) async {
        guard signedIn, plan.session == generation, !Task.isCancelled, !importingWorkspace, !listWritesBusy, let api else { return }
        workspaceImportError = nil; workspaceImportMessage = nil
        guard sharedListID == plan.target.id, sharedLists.first(where: { $0.id == plan.target.id }) == plan.target else {
            workspaceImportError = nativeText("The selected watchlist changed. Review the import again."); return
        }
        guard workspaces.contains(plan.workspace) else {
            workspaceImportError = nativeText("The published layout changed. Load it again before importing."); return
        }
        importingWorkspace = true; managingLists = true
        defer { if plan.session == generation { importingWorkspace = false; managingLists = false } }
        do {
            let _: Acknowledgement = try await api.put("/api/watchlists/\(plan.target.id)", body: ReplacementList(name: plan.target.payload.name, symbols: plan.symbols, version: plan.target.version))
            guard plan.session == generation else { return }
            listRevision += 1
            sharedLists = sharedLists.map { $0 == plan.target ? $0.replacingSymbols(plan.symbols, version: plan.target.version + 1) : $0 }
            if let selected = sharedLists.first(where: { $0.id == sharedListID }) { setWatchlist(selected.payload.symbols) }
            workspaceImportMessage = nativeText("Watchlist imported.")
            refreshAfterWorkspaceImport(session: plan.session)
        } catch {
            guard plan.session == generation, !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else {
                workspaceImportError = error.localizedDescription
                if case .response(409, _) = error as? ConnectionError { listRevision += 1; refreshAfterWorkspaceImport(session: plan.session) }
            }
        }
    }
    private func refreshAfterWorkspaceImport(session: UUID) {
        workspaceImportRefresh?.cancel()
        let request = beginListRead(), revision = listRevision
        workspaceImportRefresh = Task {
            guard session == generation, listReadRequest == request, !Task.isCancelled else { return }
            do { if try await readSharedLists(request, initialize: false), session == generation, listReadRequest == request, revision == listRevision, !Task.isCancelled { refreshSelection() } }
            catch { if session == generation, listReadRequest == request, revision == listRevision, !Task.isCancelled { await report(error, section: .watchlist) } }
        }
    }
    func loadWorkspaces(session: UUID) async {
        guard signedIn, session == generation, !Task.isCancelled, let api else { return }
        let request = UUID(); workspaceLoadRequest = request; loadingWorkspaces = true; workspaceLoadError = nil
        defer { if session == generation, workspaceLoadRequest == request { loadingWorkspaces = false } }
        func accepts() -> Bool { session == generation && workspaceLoadRequest == request && !Task.isCancelled }
        do {
            let result: SyncSnapshot? = try await api.get("/api/sync")
            guard accepts() else { return }; workspaces = result?.payload.workspace.workspaces ?? []; workspacesLoaded = true
        } catch {
            guard accepts(), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else { workspaceLoadError = error.localizedDescription }
        }
    }
    func saveAlert(_ state: AlertEditorState, locale: Locale = .current) async {
        guard signedIn, let api, state === alertEditor, !state.saving, !Task.isCancelled else { return }
        let submitted = state.draft, revision = state.revision, session = generation
        state.message = nil; state.error = nil
        guard let symbol = normalizedSymbol(submitted.symbol) else { state.error = nativeText("Enter a valid ticker."); return }
        guard let trigger = submitted.trigger else { state.error = nativeText("Choose a supported alert type."); return }
        guard let threshold = trigger.parseThreshold(submitted.threshold, locale: locale) else { state.error = nativeText(trigger.validationKey); return }
        let label = submitted.label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard label.utf16.count <= 120 else { state.error = nativeText("Use a label of up to 120 characters."); return }
        state.saving = true
        defer { if session == generation, state === alertEditor { state.saving = false } }
        do {
            let _: Acknowledgement = try await api.post("/api/alerts", body: AlertInput(symbol: symbol, trigger: trigger, threshold: threshold, label: label, repeatPolicy: submitted.repeatPolicy))
            guard session == generation, state === alertEditor else { return }
            // Once acknowledged, record the write even if the presenting view was canceled.
            if state.revision == revision {
                state.draft = AlertDraft(); state.message = nativeText("Alert saved.")
            } else { state.message = nativeText("Alert saved. Newer edits are kept as a draft.") }
            state.savedRevision += 1
            scheduleAlertRefresh(session: session)
        } catch {
            guard session == generation, state === alertEditor, !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else { state.error = error.localizedDescription }
        }
    }

    private func scheduleAlertRefresh(session: UUID) {
        // Invalidate snapshots started before the acknowledged write, before the new task runs.
        sectionRequests[.alerts] = UUID(); loadingSections.remove(.alerts); sectionUpdated[.alerts] = nil
        alertRefresh?.cancel()
        alertRefresh = Task {
            guard session == generation, !Task.isCancelled else { return }
            await refreshAlerts()
        }
    }
    func isCurrentAlertEdit(_ state: AlertEditState) -> Bool {
        signedIn && state.session == generation && alertEdits[state.ruleID] === state
    }
    func isSavingAlertEdit(_ id: Int) -> Bool { alertEdits[id]?.saving == true }
    private func editableThreshold(_ rule: AlertRule, locale: Locale) -> String? {
        AlertTrigger(metric: rule.metric ?? "native", condition: rule.condition)?.thresholdText(rule.threshold, locale: locale)
    }
    func prepareAlertEdit(_ rule: AlertRule, locale: Locale = .current) -> AlertEditState? {
        guard signedIn else { return nil }
        if let existing = alertEdits[rule.id], existing.saving || existing.reloading { return existing }
        guard !pendingAlertActions.contains(rule.id), let current = alerts.first(where: { $0.id == rule.id }), current.matchesDefinition(rule) else { return nil }
        guard current.mutationQuery != nil else { alertActionErrors[rule.id] = nativeText("Update the Mac backend before changing saved alerts."); return nil }
        if let existing = alertEdits[rule.id], existing.hasDraft || existing.needsReview {
            if let original = existing.original, !current.matchesDefinition(original) {
                existing.needsReview = true; existing.error = nativeText("This alert changed. Reload it and review your edits.")
            }
            return existing
        }
        if let existing = alertEdits[rule.id] {
            guard let text = editableThreshold(current, locale: existing.locale) else {
                alertActionErrors[rule.id] = nativeText("This alert type or threshold cannot be edited on this phone."); return nil
            }
            existing.reload(current, text: text); return existing
        }
        guard let text = editableThreshold(current, locale: locale) else {
            alertActionErrors[rule.id] = nativeText("This alert type or threshold cannot be edited on this phone."); return nil
        }
        let state = AlertEditState(rule: current, text: text, session: generation, locale: locale)
        alertEdits[rule.id] = state; return state
    }
    func reloadAlertEdit(_ state: AlertEditState) async {
        guard isCurrentAlertEdit(state), !state.saving, !state.reloading, !Task.isCancelled else { return }
        let revision = state.revision; state.reloading = true; state.error = nil; state.message = nil
        defer { if isCurrentAlertEdit(state) { state.reloading = false } }
        let loaded = await refreshAlerts()
        guard isCurrentAlertEdit(state), !Task.isCancelled else { return }
        guard state.revision == revision else { state.error = nativeText("Newer edits are kept. Reload again to discard them."); return }
        guard loaded else { state.error = nativeText("Could not reload this alert. Your draft is kept."); return }
        guard let rule = alerts.first(where: { $0.id == state.ruleID }) else {
            state.needsReview = true; state.error = nativeText("This alert is no longer available. Your draft is kept."); return
        }
        guard rule.mutationQuery != nil, let text = editableThreshold(rule, locale: state.locale) else {
            state.needsReview = true; state.error = nativeText("This alert type or threshold cannot be edited on this phone."); return
        }
        state.reload(rule, text: text)
    }
    func saveAlertEdit(_ state: AlertEditState) async {
        guard isCurrentAlertEdit(state), let api, !state.saving, !state.reloading, state.hasDraft,
              !pendingAlertActions.contains(state.ruleID), !Task.isCancelled, let original = state.original else { return }
        state.error = nil; state.message = nil
        guard !state.needsReview, let current = alerts.first(where: { $0.id == state.ruleID }), current.matchesDefinition(original) else {
            state.needsReview = true; state.error = nativeText("This alert changed. Reload it and review your edits."); return
        }
        guard let query = original.mutationQuery, let trigger = AlertTrigger(metric: original.metric ?? "native", condition: original.condition) else {
            state.error = nativeText("This alert type or threshold cannot be edited on this phone."); return
        }
        let text = state.threshold, label = state.label, revision = state.revision
        guard let threshold = trigger.parseThreshold(text, locale: state.locale) else { state.error = nativeText(trigger.validationKey); return }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.utf16.count <= 120 else { state.error = nativeText("Use a label of up to 120 characters."); return }
        let edit = AlertEdit(threshold: threshold, label: trimmed)
        state.saving = true; pendingAlertActions.insert(original.id); alertActionErrors[original.id] = nil
        defer { if isCurrentAlertEdit(state) { state.saving = false; pendingAlertActions.remove(original.id) } }
        do {
            try await api.editAlert(id: original.id, edit: edit, query: query)
            guard isCurrentAlertEdit(state) else { return }
            let acknowledged = original.updating(edit)
            alerts = alerts.map { $0.id == original.id && $0.revision == original.revision && $0.generation == original.generation ? $0.updating(edit) : $0 }
            state.acknowledge(acknowledged, text: text, label: label, submittedRevision: revision)
            scheduleAlertRefresh(session: state.session)
        } catch {
            guard isCurrentAlertEdit(state), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else if case .response(let code, _) = error as? ConnectionError, code == 409 || code == 404 {
                state.needsReview = true; state.error = nativeText("This alert changed. Reload it and review your edits.")
                scheduleAlertRefresh(session: state.session)
            } else { state.error = error.localizedDescription }
        }
    }
    func setArmed(_ rule: AlertRule, session: UUID) async {
        await changeAlert(rule, session: session, deleting: false)
    }
    func deleteAlert(_ rule: AlertRule, session: UUID) async {
        await changeAlert(rule, session: session, deleting: true)
    }
    private func changeAlert(_ rule: AlertRule, session: UUID, deleting: Bool) async {
        guard signedIn, session == generation, let api, !Task.isCancelled, !pendingAlertActions.contains(rule.id),
              let current = alerts.first(where: { $0.id == rule.id }) else { return }
        guard current.matchesDefinition(rule) else {
            alertActionErrors[rule.id] = nativeText("This alert changed. Review it and try again."); return
        }
        guard let query = rule.mutationQuery else {
            alertActionErrors[rule.id] = nativeText("Update the Mac backend before changing saved alerts."); return
        }
        pendingAlertActions.insert(rule.id); alertActionErrors[rule.id] = nil
        defer { if session == generation { pendingAlertActions.remove(rule.id) } }
        do {
            if deleting { try await api.delete("/api/alerts/\(rule.id)", query: query) }
            else { try await api.setAlertArmed(id: rule.id, armed: rule.armed == 0, query: query) }
            guard session == generation else { return }
            // A refresh may already have observed a later edit or a restored rule while this acknowledgement was in flight.
            func matchesSubmittedVersion(_ row: AlertRule) -> Bool {
                row.id == rule.id && row.revision == rule.revision && row.generation == rule.generation
            }
            if deleting { alerts.removeAll(where: matchesSubmittedVersion) }
            else { alerts = alerts.map { matchesSubmittedVersion($0) ? $0.settingArmed(rule.armed == 0) : $0 } }
            scheduleAlertRefresh(session: session)
        } catch {
            guard session == generation, !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else { alertActionErrors[rule.id] = error.localizedDescription }
        }
    }
    func loadDevices(session: UUID) async {
        guard signedIn, session == generation, !Task.isCancelled, let api else { return }
        let request = UUID(); deviceListRequest = request; loadingDevices = true; deviceListError = nil
        defer { if session == generation, deviceListRequest == request { loadingDevices = false } }
        func accepts() -> Bool { session == generation && deviceListRequest == request && !Task.isCancelled }
        do {
            let rows: [MobileDeviceInfo] = try await api.get("/api/mobile/devices")
            guard accepts() else { return }; devices = rows
            let ids = Set(rows.map(\.id)); deviceActionErrors = deviceActionErrors.filter { ids.contains($0.key) }
        } catch {
            guard accepts(), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else { deviceListError = error.localizedDescription }
        }
    }
    func revoke(_ device: MobileDeviceInfo, session: UUID) async {
        guard signedIn, session == generation, !Task.isCancelled, let api,
              device.revoked_at == nil, !pendingDeviceRevocations.contains(device.id),
              let current = devices.first(where: { $0.id == device.id }), current.revoked_at == nil else { return }
        pendingDeviceRevocations.insert(device.id); deviceActionErrors[device.id] = nil
        defer { if session == generation { pendingDeviceRevocations.remove(device.id) } }
        do {
            try await api.delete("/api/mobile/devices/\(device.id)")
            guard session == generation else { return }
            if device.id == currentDeviceID { await signOut(); return }
            let now = ISO8601DateFormatter().string(from: .now)
            devices = devices.map { $0.id == device.id ? $0.markingRevoked(at: now) : $0 }
            // Reject snapshots started before the confirmed revocation, before the new task runs.
            deviceListRequest = UUID(); loadingDevices = false; deviceRefresh?.cancel()
            deviceRefresh = Task {
                guard session == generation, !Task.isCancelled else { return }
                await loadDevices(session: session)
            }
        } catch {
            guard session == generation, !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else { deviceActionErrors[device.id] = error.localizedDescription }
        }
    }
    func checkHealth(session: UUID) async {
        guard signedIn, session == generation, let api, !checkingHealth, !Task.isCancelled else { return }
        let request = UUID(); healthRequest = request; checkingHealth = true; healthErrors = [:]
        defer { finishHealthCheck(request, session: session) }
        await withTaskCancellationHandler {
            async let connection: Void = healthCheck("Connection", session: session, request: request) {
                let status: BackendStatus = try await api.get("/api/status")
                guard status.ok else { throw ConnectionError.response(503, "The backend is not ready.") }
                return nativeText("Connected to the Mac") + " · \(status.database)"
            }
            async let backup: Void = healthCheck("Backups", session: session, request: request) {
                let schedule: BackupStatus = try await api.get("/api/data/schedule")
                return schedule.summary
            }
            async let push: Void = healthCheck("Native push", session: session, request: request) {
                let status: NativePushStatus = try await api.get("/api/mobile/push")
                return status.configured ? nativeText("Configured; device delivery not verified.") + " (\(status.environment ?? "unknown"))" : nativeText("Optional native push is not configured.")
            }
            _ = await (connection, backup, push)
        } onCancel: {
            // Release only this check, even if its transport completes after a retry starts.
            Task { @MainActor in self.finishHealthCheck(request, session: session) }
        }
    }
    private func finishHealthCheck(_ request: UUID, session: UUID) {
        guard session == generation, healthRequest == request else { return }
        healthRequest = nil; checkingHealth = false
    }
    private func healthCheck(_ name: String, session: UUID, request: UUID, read: () async throws -> String) async {
        func accepts() -> Bool { signedIn && session == generation && healthRequest == request && !Task.isCancelled }
        guard accepts() else { return }
        do {
            let message = try await read()
            guard accepts() else { return }
            health[name] = message; healthReceivedAt[name] = .now; healthErrors[name] = nil
        } catch {
            guard accepts(), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else { healthErrors[name] = error.localizedDescription }
        }
    }
    func enableNotifications() async { await registerPush(enableDelivery: true) }
    func registerExistingPush() async { await registerPush(enableDelivery: false) }
    private func registerPush(enableDelivery: Bool) async {
        guard signedIn, let api, pushOperation == nil else { return }
        if !enableDelivery && !notifications.supported { return }
        let session = generation, operation = UUID()
        pushOperation = operation; registeringPush = true
        if enableDelivery { pushMessage = nil }
        defer {
            if pushOperation == operation {
                pushOperation = nil; registeringPush = false
                if Task.isCancelled { pushMessage = nil }
            }
        }
        func current() -> Bool { signedIn && generation == session && pushOperation == operation && !Task.isCancelled }
        do {
            let status: NativePushStatus = try await api.get("/api/mobile/push")
            guard current() else { return }
            guard status.configured else {
                if enableDelivery { pushMessage = nativeText("Configure APNs keys on the Mac first.") }; return
            }
            guard notifications.supported else { pushMessage = nativeText("Native registration requires an iPhone or iPad."); return }
            let granted = enableDelivery ? try await notifications.requestAuthorization() : await notifications.isAuthorized()
            guard current() else { return }
            guard granted else {
                if enableDelivery { pushMessage = nativeText("Allow notifications in iOS Settings to receive alerts.") }; return
            }
            pushMessage = nativeText("Registering this phone…")
            let token = try await notifications.register()
            guard current() else { return }
            #if DEBUG
            let environment = "sandbox"
            #else
            let environment = "production"
            #endif
            let _: Acknowledgement = try await api.post("/api/mobile/push", body: ["token": token, "environment": environment])
            guard current() else { return }
            // Automatic registration never changes the owner's global delivery settings.
            if enableDelivery {
                let state: NotificationState = try await api.get("/api/notifications")
                guard current() else { return }
                let policy = state.settings.payload
                let _: Acknowledgement = try await api.post("/api/notifications/settings", body: EnableDelivery(enabled: true, quietStart: policy.quietStart, quietEnd: policy.quietEnd, timezone: policy.timezone, version: state.settings.version))
                guard current() else { return }
            }
            pushMessage = nativeText("Native notifications registered. Server quiet hours still apply.")
        } catch {
            guard current(), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else { pushMessage = error.localizedDescription }
        }
    }

}
enum DataSection: String, CaseIterable { case watchlist = "Watchlist", holdings = "Holdings", alerts = "Alerts", briefing = "Briefing" }
private struct BackendStatus: Decodable, Sendable { let ok: Bool; let database: String }
private struct BackupStatus: Decodable, Sendable {
    struct Policy: Decodable, Sendable { let enabled: Bool }
    struct Status: Decodable, Sendable { let lastSuccess: String?; let error: String? }
    let policy: Policy; let status: Status
    var summary: String {
        if !policy.enabled { return nativeText("Scheduled backups are disabled.") }
        if status.error != nil { return nativeText("Last backup attempt failed. Open the web Data panel to inspect and retry.") }
        guard let last = status.lastSuccess else { return nativeText("No successful scheduled backup recorded yet.") }
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = format.date(from: last) ?? ISO8601DateFormatter().date(from: last)
        guard let date, Date.now.timeIntervalSince(date) >= 0, Date.now.timeIntervalSince(date) <= 36 * 3600 else { return nativeText("Last backup is stale or has an invalid timestamp:") + " \(last)" }
        return nativeText("Last successful backup:") + " \(date.formatted(date: .abbreviated, time: .shortened))"
    }
}
private struct NewList: Encodable, Sendable { let name: String; let symbols: [String] }
private struct CreatedList: Decodable, Sendable { let id: Int }
private struct RenamedList: Encodable, Sendable { let name: String; let version: Int }
private struct OrderedSymbols: Encodable, Sendable { let symbols: [String]; let version: Int }
private struct ReplacementList: Encodable, Sendable { let name: String; let symbols: [String]; let version: Int }
private struct NotificationState:Decodable,Sendable{struct Settings:Decodable,Sendable{struct Policy:Decodable,Sendable{let quietStart:String;let quietEnd:String;let timezone:String};let version:Int;let payload:Policy};let settings:Settings}
private struct EnableDelivery:Encodable,Sendable{let enabled:Bool;let quietStart:String;let quietEnd:String;let timezone:String;let version:Int}
func number(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(2))) } ?? "—" }
