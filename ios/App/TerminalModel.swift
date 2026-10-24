import Foundation
import SwiftUI
import OpenTerminalCore
#if os(iOS)
import UIKit
import UserNotifications
#endif

@MainActor final class TerminalModel: ObservableObject {
    @Published var serverText: String
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
    @Published var devices: [MobileDeviceInfo] = []
    @Published var sharedLists: [SharedWatchlist] = []
    @Published var sharedListID: Int?
    @Published var managingLists = false
    @Published var listManagementError: String?
    @Published var researchSymbol: String?
    @Published var quotes: [Quote] = []
    @Published var portfolios: [Portfolio] = []
    @Published var portfolioID: Int?
    @Published var positions: [Position] = []
    @Published var holdingQuotes: [Quote] = []
    @Published var holdingsReady = false
    @Published var alerts: [AlertRule] = []
    @Published var briefing: Briefing?
    @Published var workspaces: [SharedWorkspace] = []
    @Published var watchlist: [String] = []
    private(set) var api: TerminalAPI?
    private(set) var server: ServerConnection?
    private var generation = UUID()
    private var refreshID: UUID?
    private let defaults: UserDefaults
    private let credentials: any CredentialStorage
    private let makeClient: (ServerConnection, MobileCredential?) -> TerminalAPI
    private var listRevision = 0
    private var credential: MobileCredential?
    private var renewedAt = Date.now
    private var restoreAttempted = false
    private var enableDeliveryAfterRegistration = false
    var retryDelay: Double = 2
    var valuation: HoldingValuation? { holdingsReady ? HoldingValuation(positions: positions, quotes: holdingQuotes) : nil }

    init(defaults: UserDefaults = .standard, credentials: any CredentialStorage = KeychainCredentialStorage(),
         makeClient: @escaping (ServerConnection, MobileCredential?) -> TerminalAPI = { TerminalAPI(server: $0, credential: $1) }) {
        self.defaults = defaults; self.credentials = credentials; self.makeClient = makeClient
        serverText = defaults.string(forKey: "server") ?? ""
    }

    private func persist(_ value: MobileCredential, at connection: ServerConnection) throws {
        if rememberDevice { try credentials.save(JSONEncoder().encode(value), server: connection.origin.absoluteString) }
        else { credentials.remove(connection.origin.absoluteString) }
    }
    func signIn(password: String) async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let connection = try ServerConnection(serverText), client = makeClient(connection, nil)
            let value = try await client.pair(password: password, name: deviceName)
            do { try persist(value, at: connection) } catch { await client.signOut(); throw error }
            credential = value; renewedAt = .now; generation = UUID(); api = client; server = connection; signedIn = true
            defaults.set(connection.origin.absoluteString, forKey: "server")
        } catch { self.error = error.localizedDescription }
    }
    func restoreSession(force: Bool = false) async {
        guard force || !restoreAttempted else { return }; restoreAttempted = true; restoring = true; defer { restoring = false }
        do {
            let connection = try ServerConnection(serverText)
            guard let data = try credentials.load(connection.origin.absoluteString) else { if force {error="No saved device authorization for this server. Sign in once to pair it."}; return }
            let value = try JSONDecoder().decode(MobileCredential.self, from: data)
            server = connection
            let client = makeClient(connection, value), fresh = try await client.renewDevice()
            try persist(fresh, at: connection)
            api = client; credential = fresh; renewedAt = .now; generation = UUID(); signedIn = true
        } catch ConnectionError.invalidServer { }
        catch {
            if error as? ConnectionError == .unauthorized, let server { credentials.remove(server.origin.absoluteString) }
            self.error = error.localizedDescription
        }
    }
    func signOut() async {
        let old = api
        if let server { credentials.remove(server.origin.absoluteString) }
        generation = UUID(); credential = nil; api = nil; server = nil; signedIn = false
        quotes = []; portfolios = []; positions = []; holdingQuotes = []; alerts = []; briefing = nil; workspaces = []; portfolioID = nil; holdingsReady = false
        sharedLists = []; sharedListID = nil; devices = []; watchlist = []; lastUpdated = nil; reconnecting = false; error = nil
        managingLists = false; listManagementError = nil
        enableDeliveryAfterRegistration=false
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
            async let rules: Void = refreshAlerts()
            _ = await (lists, accounts, rules)
            if token == generation && !Task.isCancelled && self.error == nil && sectionErrors.isEmpty { lastUpdated = .now; reconnecting = false; retryDelay = 2 }
        } catch { if token == generation && !Task.isCancelled { await report(error) } }
    }
    private func begin(_ section: DataSection) { loadingSections.insert(section); sectionErrors[section] = nil }
    private func finish(_ section: DataSection, token: UUID) { if token == generation { loadingSections.remove(section) } }
    private func refreshWatchlistData() async {
        let token = generation; begin(.watchlist); begin(.briefing)
        defer { finish(.watchlist, token: token); finish(.briefing, token: token) }
        do {
            try await refreshLists(); guard token == generation else { return }
            async let prices: Void = refreshQuotes()
            async let summary: Void = refreshBriefing()
            _ = await (prices, summary)
        } catch { if token == generation {
            await report(error, section: .watchlist)
            if token == generation && !(error is CancellationError) { sectionErrors[.briefing] = "Briefing could not refresh because the shared watchlist is unavailable." }
        } }
    }
    private func refreshAccounts() async {
        guard let api else { return }; let token = generation; begin(.holdings); defer { finish(.holdings, token: token) }
        do {
            let accounts: [Portfolio] = try await api.get("/api/portfolios")
            guard token == generation else { return }; portfolios = accounts
            if !accounts.contains(where: { $0.id == portfolioID }) { portfolioID = accounts.first?.id }
            await refreshHoldings()
        } catch { if token == generation { await report(error, section: .holdings) } }
    }
    private func refreshAlerts() async {
        guard let api else { return }; let token = generation; begin(.alerts); defer { finish(.alerts, token: token) }
        do {
            let rules: AlertList = try await api.get("/api/alerts")
            if token == generation { alerts = rules.alerts; sectionUpdated[.alerts] = .now }
        } catch { if token == generation { await report(error, section: .alerts) } }
    }
    func refreshQuotes() async {
        guard let api else { return }; let token = generation, symbols = watchlist
        begin(.watchlist); defer { finish(.watchlist, token: token) }
        if symbols.isEmpty { quotes = []; sectionUpdated[.watchlist] = .now; return }
        do { let rows: [Quote] = try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")]); if token == generation && symbols == watchlist { quotes = rows; sectionUpdated[.watchlist] = .now } }
        catch { if token == generation && symbols == watchlist && !Task.isCancelled { await report(error, section: .watchlist) } }
    }
    func refreshHoldings() async {
        guard let api else { return }; let token = generation; begin(.holdings); defer { finish(.holdings, token: token) }
        guard let id = portfolioID else { holdingsReady = false; positions = []; holdingQuotes = []; sectionUpdated[.holdings] = .now; return }; holdingsReady = false
        do {
            let rows: [Position] = try await api.get("/api/portfolios/\(id)/positions"), symbols = rows.map(\.symbol)
            let prices: [Quote] = symbols.isEmpty ? [] : try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")])
            guard token == generation && id == portfolioID else { return }; positions = rows; holdingQuotes = prices; holdingsReady = true; sectionUpdated[.holdings] = .now
        } catch { if token == generation && id == portfolioID && !Task.isCancelled { await report(error, section: .holdings) } }
    }
    func refreshBriefing() async {
        guard let api else { return }; let token = generation, symbols = Array(watchlist.prefix(12)); begin(.briefing); defer { finish(.briefing, token: token) }
        if symbols.isEmpty { briefing = nil; sectionUpdated[.briefing] = .now; return }
        do { let result: Briefing = try await api.get("/api/briefings/current", query: ["symbols": symbols.joined(separator: ","), "mode": "pre-market"]); if token == generation && symbols == Array(watchlist.prefix(12)) { briefing = result; sectionUpdated[.briefing] = .now } }
        catch { if token == generation && symbols == Array(watchlist.prefix(12)) && !Task.isCancelled { await report(error, section: .briefing) } }
    }
    private func setWatchlist(_ symbols: [String]) {
        if watchlist != symbols {
            watchlist = symbols; quotes = []; briefing = nil
            for section in [DataSection.watchlist, .briefing] { sectionUpdated[section] = nil; sectionErrors[section] = nil }
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
        if let row = sharedLists.first(where: { $0.id == id }) { setWatchlist(row.payload.symbols) }; Task { await refresh() }
    }
    @discardableResult func createList(name: String, copyCurrent: Bool = false) async -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 64 else { listManagementError = "Use a name of 1–64 characters."; return false }
        let symbols = copyCurrent ? watchlist : []
        return await manageLists { api in
            let result: CreatedList = try await api.post("/api/watchlists", body: NewList(name: name, symbols: symbols)); return result.id
        }
    }
    @discardableResult func renameList(_ row: SharedWatchlist, name: String) async -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 64 else { listManagementError = "Use a name of 1–64 characters."; return false }
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
            Task { await refresh() }; return true
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
    func replaceWatchlist(_ symbols: [String]) async {
        guard let api, let id = sharedListID, let row = sharedLists.first(where: { $0.id == id }) else { return }; let token = generation
        do { let _: Acknowledgement = try await api.put("/api/watchlists/\(id)", body: ReplacementList(name: row.payload.name, symbols: symbols, version: row.version)); if token == generation { listRevision += 1; try await refreshLists(); await refreshQuotes() } }
        catch { if token == generation { await report(error) } }
    }
    func loadWorkspaces() async {
        guard let api else { return }; let token = generation
        do { let result: SyncSnapshot? = try await api.get("/api/sync"); if token == generation { workspaces = result?.payload.workspace.workspaces ?? [] } }
        catch { if token == generation { await report(error) } }
    }
    func setArmed(_ rule: AlertRule) async {
        guard let api else { return }; let token = generation
        do { try await api.setAlertArmed(id: rule.id, armed: rule.armed == 0); if token == generation { await refresh() } }
        catch { if token == generation { await report(error) } }
    }
    func loadDevices() async { guard let api else { return }; let token = generation; do { let rows:[MobileDeviceInfo] = try await api.get("/api/mobile/devices"); if token == generation { devices = rows } } catch { if token == generation { await report(error) } } }
    func revoke(_ id: String) async {
        guard let api else { return }; let token = generation
        do { try await api.delete("/api/mobile/devices/\(id)"); guard token == generation else { return }; if id == credential?.id { await signOut() } else { await loadDevices() } } catch { if token == generation { await report(error) } }
    }
    func checkHealth() async {
        guard let api, !checkingHealth else { return }; let token = generation
        checkingHealth = true; health = [:]; defer { if token == generation { checkingHealth = false } }
        async let connection: Void = healthCheck("Connection", token: token) {
            let status: BackendStatus = try await api.get("/api/status")
            guard status.ok else { throw ConnectionError.response(503, "The backend is not ready.") }
            return "Connected to the Mac · \(status.database)"
        }
        async let backup: Void = healthCheck("Backups", token: token) {
            let schedule: BackupStatus = try await api.get("/api/data/schedule")
            return schedule.summary
        }
        async let push: Void = healthCheck("Native push", token: token) {
            let status: NativePushStatus = try await api.get("/api/mobile/push")
            return status.configured ? "Configured (\(status.environment ?? "unknown")); device delivery not verified." : "Optional native push is not configured."
        }
        _ = await (connection, backup, push)
    }
    private func healthCheck(_ name: String, token: UUID, read: () async throws -> String) async {
        do { let message = try await read(); if token == generation { health[name] = message } }
        catch { if token == generation && !Task.isCancelled { if error as? ConnectionError == .unauthorized { await report(error) } else { health[name] = error.localizedDescription } } }
    }
    func enableNotifications() async {
        guard let api else { return }
        do {
            let status: NativePushStatus = try await api.get("/api/mobile/push")
            guard status.configured else { pushMessage = "Configure APNs keys on the Mac first."; return }
            #if os(iOS)
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            guard granted else { pushMessage = "Allow notifications in iOS Settings to receive alerts."; return }
            enableDeliveryAfterRegistration=true
            UIApplication.shared.registerForRemoteNotifications(); pushMessage = "Registering this phone…"
            #else
            pushMessage = "Native registration requires an iPhone or iPad."
            #endif
        } catch { pushMessage = error.localizedDescription }
    }
    func registerExistingPush() async {
        #if os(iOS)
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        if settings.authorizationStatus == .authorized { UIApplication.shared.registerForRemoteNotifications() }
        #endif
    }
    func receivedPushToken(_ token: String) async {
        guard let api else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        do {
            let _: Acknowledgement = try await api.post("/api/mobile/push", body: ["token": token, "environment": environment])
            if enableDeliveryAfterRegistration {
                let state:NotificationState=try await api.get("/api/notifications")
                let policy=state.settings.payload
                let _:Acknowledgement=try await api.post("/api/notifications/settings",body:EnableDelivery(enabled:true,quietStart:policy.quietStart,quietEnd:policy.quietEnd,timezone:policy.timezone,version:state.settings.version))
                enableDeliveryAfterRegistration=false
            }
            pushMessage = "Native notifications registered. Server quiet hours still apply."
        }
        catch { pushMessage = error.localizedDescription }
    }
}
enum DataSection: String, CaseIterable { case watchlist = "Watchlist", holdings = "Holdings", alerts = "Alerts", briefing = "Briefing" }
private struct BackendStatus: Decodable, Sendable { let ok: Bool; let database: String }
private struct BackupStatus: Decodable, Sendable {
    struct Policy: Decodable, Sendable { let enabled: Bool }
    struct Status: Decodable, Sendable { let lastSuccess: String?; let error: String? }
    let policy: Policy; let status: Status
    var summary: String {
        if !policy.enabled { return "Scheduled backups are disabled." }
        if status.error != nil { return "Last backup attempt failed. Open the web Data panel to inspect and retry." }
        guard let last = status.lastSuccess else { return "No successful scheduled backup recorded yet." }
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = format.date(from: last) ?? ISO8601DateFormatter().date(from: last)
        guard let date, Date.now.timeIntervalSince(date) >= 0, Date.now.timeIntervalSince(date) <= 36 * 3600 else { return "Last backup is stale or has an invalid timestamp: \(last)" }
        return "Last successful backup: \(date.formatted(date: .abbreviated, time: .shortened))"
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
