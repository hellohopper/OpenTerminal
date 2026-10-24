import Foundation
import SwiftUI
import OpenTerminalCore
#if os(iOS)
import UIKit
import UserNotifications
#endif

@MainActor final class TerminalModel: ObservableObject {
    @Published var serverText = UserDefaults.standard.string(forKey: "server") ?? ""
    @Published var signedIn = false
    @Published var busy = false
    @Published var restoring = true
    @Published var rememberDevice = true
    @Published var deviceName = "My iPhone"
    @Published var error: String?
    @Published var lastUpdated: Date?
    @Published var reconnecting = false
    @Published var pushMessage: String?
    @Published var devices: [MobileDeviceInfo] = []
    @Published var sharedLists: [SharedWatchlist] = []
    @Published var sharedListID: Int?
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
    private var refreshing = false
    private var listRevision = 0
    private var credential: MobileCredential?
    private var renewedAt = Date.now
    private var restoreAttempted = false
    private var enableDeliveryAfterRegistration = false
    var retryDelay: Double = 2
    var valuation: HoldingValuation? { holdingsReady ? HoldingValuation(positions: positions, quotes: holdingQuotes) : nil }

    private func persist(_ value: MobileCredential, at connection: ServerConnection) throws {
        if rememberDevice { try CredentialStore.save(JSONEncoder().encode(value), server: connection.origin.absoluteString) }
        else { CredentialStore.remove(connection.origin.absoluteString) }
    }
    func signIn(password: String) async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let connection = try ServerConnection(serverText), client = TerminalAPI(server: connection)
            let value = try await client.pair(password: password, name: deviceName)
            do { try persist(value, at: connection) } catch { await client.signOut(); throw error }
            credential = value; renewedAt = .now; generation = UUID(); api = client; server = connection; signedIn = true
            UserDefaults.standard.set(connection.origin.absoluteString, forKey: "server")
            await refresh(); await registerExistingPush()
        } catch { self.error = error.localizedDescription }
    }
    func restoreSession(force: Bool = false) async {
        guard force || !restoreAttempted else { return }; restoreAttempted = true; restoring = true; defer { restoring = false }
        do {
            let connection = try ServerConnection(serverText)
            guard let data = try CredentialStore.load(connection.origin.absoluteString) else { if force {error="No saved device authorization for this server. Sign in once to pair it."}; return }
            let value = try JSONDecoder().decode(MobileCredential.self, from: data)
            server = connection
            let client = TerminalAPI(server: connection, credential: value), fresh = try await client.renewDevice()
            try persist(fresh, at: connection)
            api = client; credential = fresh; renewedAt = .now; generation = UUID(); signedIn = true
            await refresh(); await registerExistingPush()
        } catch ConnectionError.invalidServer { }
        catch {
            if error as? ConnectionError == .unauthorized, let server { CredentialStore.remove(server.origin.absoluteString) }
            self.error = error.localizedDescription
        }
    }
    func signOut() async {
        let old = api
        if let server { CredentialStore.remove(server.origin.absoluteString) }
        generation = UUID(); credential = nil; api = nil; server = nil; signedIn = false
        quotes = []; portfolios = []; positions = []; holdingQuotes = []; alerts = []; briefing = nil; workspaces = []; portfolioID = nil; holdingsReady = false
        sharedLists = []; sharedListID = nil; devices = []; watchlist = []; lastUpdated = nil; reconnecting = false; error = nil
        enableDeliveryAfterRegistration=false
        await old?.signOut()
    }
    func report(_ error: Error) async {
        if error is CancellationError { return }
        if error as? ConnectionError == .unauthorized { await signOut() }
        else { reconnecting = true; retryDelay = min(30, max(2, retryDelay * 2)) }
        self.error = error.localizedDescription
    }
    func refresh() async {
        guard let api, !refreshing else { return }; refreshing = true; defer { refreshing = false }
        let token = generation; error = nil
        do {
            if Date.now.timeIntervalSince(renewedAt) > 86400 {
                let value = try await api.renewDevice(); guard token == generation else { return }
                credential = value; renewedAt = .now; if let server { try persist(value, at: server) }
            }
            try await refreshLists()
            let accounts: [Portfolio] = try await api.get("/api/portfolios")
            guard token == generation else { return }; portfolios = accounts
            if !accounts.contains(where: { $0.id == portfolioID }) { portfolioID = accounts.first?.id }
            let rules: AlertList = try await api.get("/api/alerts")
            guard token == generation else { return }; alerts = rules.alerts
            await refreshQuotes(); await refreshHoldings(); await refreshBriefing()
            if token == generation && self.error == nil { lastUpdated = .now; reconnecting = false; retryDelay = 2 }
        } catch { if token == generation && !Task.isCancelled { await report(error) } }
    }
    func refreshQuotes() async {
        guard let api else { return }; let token = generation, symbols = watchlist
        if symbols.isEmpty { quotes = []; return }
        do { let rows: [Quote] = try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")]); if token == generation && symbols == watchlist { quotes = rows } }
        catch { if token == generation && !Task.isCancelled { await report(error) } }
    }
    func refreshHoldings() async {
        guard let api, let id = portfolioID else { holdingsReady = false; return }; let token = generation; holdingsReady = false
        do {
            let rows: [Position] = try await api.get("/api/portfolios/\(id)/positions"), symbols = rows.map(\.symbol)
            let prices: [Quote] = symbols.isEmpty ? [] : try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")])
            guard token == generation && id == portfolioID else { return }; positions = rows; holdingQuotes = prices; holdingsReady = true
        } catch { if token == generation && id == portfolioID && !Task.isCancelled { await report(error) } }
    }
    func refreshBriefing() async {
        guard let api, !watchlist.isEmpty else { briefing = nil; return }; let token = generation, symbols = Array(watchlist.prefix(12))
        do { let result: Briefing = try await api.get("/api/briefings/current", query: ["symbols": symbols.joined(separator: ","), "mode": "pre-market"]); if token == generation && symbols == Array(watchlist.prefix(12)) { briefing = result } }
        catch { if token == generation && !Task.isCancelled { await report(error) } }
    }
    private func setWatchlist(_ symbols: [String]) { if watchlist != symbols { watchlist = symbols; quotes = []; briefing = nil } }
    func refreshLists() async throws {
        guard let api else { return }; let token = generation, revision = listRevision
        var lists: [SharedWatchlist] = try await api.get("/api/watchlists")
        if lists.isEmpty {
            let legacy = server.flatMap { UserDefaults.standard.stringArray(forKey: "watchlist:\($0.origin.absoluteString)") } ?? ["AAPL", "MSFT", "NVDA", "SPY"]
            let _: Acknowledgement = try await api.post("/api/watchlists/default", body: NewList(name: "My watchlist", symbols: legacy.compactMap(normalizedSymbol)))
            lists = try await api.get("/api/watchlists")
        }
        guard token == generation, revision == listRevision else { return }; sharedLists = lists
        let saved = server.map { UserDefaults.standard.integer(forKey: "shared-list:\($0.origin.absoluteString)") }
        let selected = lists.first { $0.id == (sharedListID ?? saved) } ?? lists.first
        if let selected { sharedListID = selected.id; setWatchlist(selected.payload.symbols) }
    }
    func chooseList(_ id: Int) {
        listRevision += 1
        sharedListID = id
        if let server { UserDefaults.standard.set(id, forKey: "shared-list:\(server.origin.absoluteString)") }
        if let row = sharedLists.first(where: { $0.id == id }) { setWatchlist(row.payload.symbols) }; Task { await refresh() }
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
private struct NewList: Encodable, Sendable { let name: String; let symbols: [String] }
private struct ReplacementList: Encodable, Sendable { let name: String; let symbols: [String]; let version: Int }
private struct NotificationState:Decodable,Sendable{struct Settings:Decodable,Sendable{struct Policy:Decodable,Sendable{let quietStart:String;let quietEnd:String;let timezone:String};let version:Int;let payload:Policy};let settings:Settings}
private struct EnableDelivery:Encodable,Sendable{let enabled:Bool;let quietStart:String;let quietEnd:String;let timezone:String;let version:Int}
func number(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(2))) } ?? "—" }
