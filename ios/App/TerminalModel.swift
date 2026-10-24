import Foundation
import SwiftUI
import OpenTerminalCore

@MainActor final class TerminalModel: ObservableObject {
    @Published var serverText = UserDefaults.standard.string(forKey: "server") ?? ""
    @Published var signedIn = false
    @Published var busy = false
    @Published var error: String?
    @Published var quotes: [Quote] = []
    @Published var portfolios: [Portfolio] = []
    @Published var portfolioID: Int?
    @Published var positions: [Position] = []
    @Published var holdingQuotes: [Quote] = []
    @Published var holdingsReady = false
    @Published var alerts: [AlertRule] = []
    @Published var briefing: Briefing?
    @Published var workspaces: [SharedWorkspace] = []
    @Published var watchlist: [String] = ["AAPL", "MSFT", "NVDA", "SPY"]
    private(set) var api: TerminalAPI?
    private(set) var server: ServerConnection?
    private var generation = UUID()
    private var refreshing = false
    var valuation: HoldingValuation? { holdingsReady ? HoldingValuation(positions: positions, quotes: holdingQuotes) : nil }

    func signIn(password: String) async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let connection = try ServerConnection(serverText), client = TerminalAPI(server: connection)
            try await client.signIn(password: password)
            generation = UUID(); api = client; server = connection; signedIn = true
            UserDefaults.standard.set(connection.origin.absoluteString, forKey: "server")
            watchlist = (UserDefaults.standard.stringArray(forKey: "watchlist:\(connection.origin.absoluteString)") ?? ["AAPL", "MSFT", "NVDA", "SPY"]).compactMap(normalizedSymbol)
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
    func signOut() async {
        let old = api
        generation = UUID(); api = nil; server = nil; signedIn = false
        quotes = []; portfolios = []; positions = []; holdingQuotes = []; alerts = []; briefing = nil; workspaces = []; portfolioID = nil; holdingsReady = false; error = nil
        await old?.signOut()
    }
    func report(_ error: Error) async {
        if error as? ConnectionError == .unauthorized { await signOut() }
        self.error = error.localizedDescription
    }
    func refresh() async {
        guard let api, !refreshing else { return }
        refreshing = true; defer { refreshing = false }
        let token = generation; error = nil
        do {
            let accounts: [Portfolio] = try await api.get("/api/portfolios")
            guard token == generation else { return }; portfolios = accounts
            if !accounts.contains(where: { $0.id == portfolioID }) { portfolioID = accounts.first?.id }
            let rules: AlertList = try await api.get("/api/alerts")
            guard token == generation else { return }; alerts = rules.alerts
            await refreshQuotes()
            await refreshHoldings()
            await refreshBriefing()
        } catch { if token == generation { await report(error) } }
    }
    func refreshQuotes() async {
        guard let api else { return }; let token = generation, symbols = watchlist
        if symbols.isEmpty { quotes = []; return }
        do { let rows: [Quote] = try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")]); if token == generation && symbols == watchlist { quotes = rows } }
        catch { if token == generation { await report(error) } }
    }
    func refreshHoldings() async {
        guard let api, let id = portfolioID else { holdingsReady = false; return }
        let token = generation; holdingsReady = false
        do {
            let rows: [Position] = try await api.get("/api/portfolios/\(id)/positions")
            let symbols = rows.map(\.symbol)
            let prices: [Quote] = symbols.isEmpty ? [] : try await api.get("/api/quotes", query: ["symbols": symbols.joined(separator: ",")])
            guard token == generation && id == portfolioID else { return }
            positions = rows; holdingQuotes = prices; holdingsReady = true
        } catch { if token == generation && id == portfolioID { positions = []; holdingQuotes = []; await report(error) } }
    }
    func refreshBriefing() async {
        guard let api, !watchlist.isEmpty else { briefing = nil; return }
        let token = generation, symbols = Array(watchlist.prefix(12))
        do { let result: Briefing = try await api.get("/api/briefings/current", query: ["symbols": symbols.joined(separator: ","), "mode": "pre-market"]); if token == generation && symbols == Array(watchlist.prefix(12)) { briefing = result } }
        catch { if token == generation { await report(error) } }
    }
    func setWatchlist(_ symbols: [String]) {
        var seen = Set<String>()
        watchlist = Array(symbols.compactMap(normalizedSymbol).filter { seen.insert($0).inserted }.prefix(150))
        quotes = []; briefing = nil
        if let server { UserDefaults.standard.set(watchlist, forKey: "watchlist:\(server.origin.absoluteString)") }
    }
    func loadWorkspaces() async {
        guard let api else { return }; let token = generation
        do { let result: SyncSnapshot? = try await api.get("/api/sync"); if token == generation { workspaces = result?.payload.workspace.workspaces ?? [] } }
        catch { if token == generation { await report(error) } }
    }
    func setArmed(_ rule: AlertRule) async {
        guard let api else { return }
        do { try await api.setAlertArmed(id: rule.id, armed: rule.armed == 0); await refresh() } catch { await report(error) }
    }
}

func number(_ value: Double?) -> String { value.map { $0.formatted(.number.precision(.fractionLength(2))) } ?? "—" }
