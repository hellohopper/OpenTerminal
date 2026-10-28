import Foundation
import SwiftUI
import OpenTerminalCore

enum TerminalTab: String, CaseIterable { case today, watchlist, holdings, alerts }

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
    @Published var health: [String: String] = [:]
    @Published var checkingHealth = false
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
    @Published var sharedListID: Int?
    @Published var managingLists = false
    @Published var listManagementError: String?
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
        pushOperation = nil; registeringPush = false; pushMessage = nil
        refreshID = nil; sectionErrors = [:]; sectionUpdated = [:]; loadingSections = []; health = [:]; checkingHealth = false
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
        let token = generation, revision = listRevision, pricesRequest = begin(.watchlist), briefingRequest = begin(.briefing)
        defer { finish(.watchlist, request: pricesRequest, token: token); finish(.briefing, request: briefingRequest, token: token) }
        do {
            try await refreshLists(); guard token == generation, revision == listRevision, !Task.isCancelled else { return }
            async let prices: Void = refreshQuotes()
            async let summary: Void = refreshBriefing()
            _ = await (prices, summary)
        } catch { if revision == listRevision && current(.watchlist, request: pricesRequest, token: token) {
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
    func refreshLists() async throws {
        guard let api else { return }; let token = generation, revision = listRevision
        var lists: [SharedWatchlist] = try await api.get("/api/watchlists")
        guard token == generation, revision == listRevision else { return }
        if lists.isEmpty {
            let legacy = server.flatMap { defaults.stringArray(forKey: "watchlist:\($0.origin.absoluteString)") } ?? ["AAPL", "MSFT", "NVDA", "SPY"]
            let _: Acknowledgement = try await api.post("/api/watchlists/default", body: NewList(name: "My watchlist", symbols: legacy.compactMap(normalizedSymbol)))
            lists = try await api.get("/api/watchlists")
        }
        guard token == generation, revision == listRevision else { return }; sharedLists = lists
        let saved = server.map { defaults.integer(forKey: "shared-list:\($0.origin.absoluteString)") }
        let selected = lists.first { $0.id == (sharedListID ?? saved) } ?? lists.first
        if let selected { sharedListID = selected.id; setWatchlist(selected.payload.symbols) }
        else { sharedListID = nil; setWatchlist([]) }
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
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 64 else { listManagementError = nativeText("Use a name of 1–64 characters."); return false }
        let symbols = copyCurrent ? watchlist : []
        return await manageLists { api in
            let result: CreatedList = try await api.post("/api/watchlists", body: NewList(name: name, symbols: symbols)); return result.id
        }
    }
    @discardableResult func renameList(_ row: SharedWatchlist, name: String) async -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 64 else { listManagementError = nativeText("Use a name of 1–64 characters."); return false }
        return await manageLists { api in
            let _: Acknowledgement = try await api.post("/api/watchlists/\(row.id)/rename", body: RenamedList(name: name, version: row.version)); return nil
        }
    }
    @discardableResult func deleteList(_ row: SharedWatchlist) async -> Bool {
        await manageLists { api in try await api.delete("/api/watchlists/\(row.id)", query: ["version": String(row.version)]); return nil }
    }
    func moveList(_ row: SharedWatchlist, direction: String) async {
        await manageLists { api in
            let _: [SharedWatchlist] = try await api.post("/api/watchlists/\(row.id)/move", body: ["direction": direction]); return nil
        }
    }
    func moveSymbol(_ symbol: String, direction: Int) async {
        guard let row = sharedLists.first(where: { $0.id == sharedListID }), let index = row.payload.symbols.firstIndex(of: symbol) else { return }
        var symbols = row.payload.symbols; let next = index + direction
        guard symbols.indices.contains(next) else { return }; symbols.swapAt(index, next)
        await manageLists { api in
            let _: Acknowledgement = try await api.post("/api/watchlists/\(row.id)/reorder-symbols", body: OrderedSymbols(symbols: symbols, version: row.version)); return nil
        }
    }
    @discardableResult private func manageLists(_ operation: (TerminalAPI) async throws -> Int?) async -> Bool {
        guard let api, !managingLists else { return false }; let token = generation
        managingLists = true; listManagementError = nil; listRevision += 1
        defer { if token == generation { managingLists = false } }
        do {
            let selected = try await operation(api); guard token == generation else { return false }
            listRevision += 1
            if let selected {
                sharedListID = selected
                if let server { defaults.set(selected, forKey: "shared-list:\(server.origin.absoluteString)") }
            }
            try await refreshLists(); guard token == generation else { return false }
            // Updating quotes must not keep the management controls waiting on a market provider.
            refreshSelection(); return true
        } catch {
            guard token == generation else { return false }
            if error as? ConnectionError == .unauthorized { await report(error) }
            else {
                listManagementError = error.localizedDescription
                listRevision += 1
                do { try await refreshLists() }
                catch { if token == generation && error as? ConnectionError == .unauthorized { await report(error) } }
            }
            return false
        }
    }
    func changeSymbol(_ symbol: String, action: String) async {
        guard let value = normalizedSymbol(symbol), let api, let id = sharedListID else { return }; let token = generation
        do {
            let row: SharedWatchlist = try await api.post("/api/watchlists/\(id)/symbols", body: ["symbol": value, "action": action])
            guard token == generation, id == sharedListID else { return }
            if let current = sharedLists.first(where: { $0.id == id }), current.version > row.version { return }
            listRevision += 1
            sharedLists = sharedLists.map { $0.id == id ? row : $0 }; setWatchlist(row.payload.symbols); await refreshQuotes()
        } catch { if token == generation { await report(error) } }
    }
    func prepareWorkspaceImport(_ workspace: SharedWorkspace) -> WatchlistImportPlan? {
        guard signedIn, !loadingWorkspaces, !importingWorkspace, !managingLists else { return nil }
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
        guard signedIn, plan.session == generation, !Task.isCancelled, !importingWorkspace, !managingLists, let api else { return }
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
        workspaceImportRefresh = Task {
            guard session == generation, !Task.isCancelled else { return }
            let revision = listRevision
            do { try await refreshLists(); if session == generation, revision == listRevision, !Task.isCancelled { refreshSelection() } }
            catch { if session == generation, revision == listRevision, !Task.isCancelled { await report(error, section: .watchlist) } }
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
    func checkHealth() async {
        guard let api, !checkingHealth else { return }; let token = generation
        checkingHealth = true; health = [:]; defer { if token == generation { checkingHealth = false } }
        async let connection: Void = healthCheck("Connection", token: token) {
            let status: BackendStatus = try await api.get("/api/status")
            guard status.ok else { throw ConnectionError.response(503, "The backend is not ready.") }
            return nativeText("Connected to the Mac") + " · \(status.database)"
        }
        async let backup: Void = healthCheck("Backups", token: token) {
            let schedule: BackupStatus = try await api.get("/api/data/schedule")
            return schedule.summary
        }
        async let push: Void = healthCheck("Native push", token: token) {
            let status: NativePushStatus = try await api.get("/api/mobile/push")
            return status.configured ? nativeText("Configured; device delivery not verified.") + " (\(status.environment ?? "unknown"))" : nativeText("Optional native push is not configured.")
        }
        _ = await (connection, backup, push)
    }
    private func healthCheck(_ name: String, token: UUID, read: () async throws -> String) async {
        do { let message = try await read(); if token == generation { health[name] = message } }
        catch { if token == generation && !Task.isCancelled { if error as? ConnectionError == .unauthorized { await report(error) } else { health[name] = error.localizedDescription } } }
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
