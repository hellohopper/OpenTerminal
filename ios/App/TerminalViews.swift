import SwiftUI
import OpenTerminalCore

struct TerminalTabs: View {
    @EnvironmentObject private var model: TerminalModel
    @Environment(\.scenePhase) private var phase
    var body: some View {
        TabView {
            TerminalPage(title: "Today") { TodayView() }.tabItem { Label("Today", systemImage: "sun.max") }
            TerminalPage(title: "Watchlist") { WatchlistView() }.tabItem { Label("Watchlist", systemImage: "star") }
            TerminalPage(title: "Holdings") { HoldingsView() }.tabItem { Label("Holdings", systemImage: "chart.pie") }
            TerminalPage(title: "Alerts") { AlertsView() }.tabItem { Label("Alerts", systemImage: "bell") }
        }.task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(30)) } catch { break }
            }
        }
    }
}
private struct TerminalPage<Content: View>: View {
    @EnvironmentObject private var model: TerminalModel
    @ViewState<Bool> private var settings = false
    let title: String
    let content: Content
    init(title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        NavigationStack {
            content.navigationTitle(title)
                .safeAreaInset(edge: .top) {
                    if let error = model.error {
                        HStack { Text(error).font(.callout); Spacer(); Button("Retry") { Task { await model.refresh() } } }
                            .padding().background(.orange.opacity(0.15)).accessibilityElement(children: .contain)
                    }
                }
                .toolbar { ToolbarItem(placement: .primaryAction) { Button { settings = true } label: { Label("Settings", systemImage: "gearshape") } } }
                .sheet(isPresented: $settings) { SettingsView() }
        }
    }
}
private struct TodayView: View {
    @EnvironmentObject private var model: TerminalModel
    var body: some View {
        List {
            if let briefing = model.briefing {
                Section(briefing.date) { Text(briefing.summary) }
                Section("Market") { ForEach(briefing.indexes) { QuoteRow(quote: $0) } }
                Section("Headlines") { ForEach(briefing.headlines.prefix(5)) { item in if let url = item.url { Link(item.title, destination: url) } } }
                if !briefing.warnings.isEmpty { Section("Data coverage") { ForEach(briefing.warnings, id: \.self) { Text($0).font(.callout).foregroundStyle(.secondary) } } }
            } else { Section { Text("Add symbols to your watchlist and pull to refresh your briefing.") } }
            Section("Your holdings") {
                LabeledContent("Position value", value: number(model.valuation?.marketValue))
                LabeledContent("Unrealized P&L", value: number(model.valuation?.unrealized))
                Text("Positions only; excludes cash. Missing, stale or unverified USD quotes withhold totals.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Alerts") { Text("\(model.alerts.filter { $0.armed != 0 }.count) active alerts") }
        }.refreshable { await model.refresh() }
    }
}
struct QuoteRow: View {
    let quote: Quote
    var body: some View {
        HStack {
            VStack(alignment: .leading) { Text(quote.symbol).font(.headline); Text(quote.name ?? quote.source).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            Spacer()
            VStack(alignment: .trailing) {
                Text(number(quote.price)).monospacedDigit()
                Text("\(number(quote.changePercent))%").font(.callout).monospacedDigit().foregroundStyle((quote.changePercent ?? 0) < 0 ? .red : .green)
                if quote.stale == true { Text("Cached / stale").font(.caption).foregroundStyle(.orange) }
            }
        }.padding(.vertical, 4)
    }
}
private struct WatchlistView: View {
    @EnvironmentObject private var model: TerminalModel
    @ViewState<String> private var symbol = ""
    @ViewState<Bool> private var invalid = false
    var body: some View {
        List {
            Section {
                HStack {
                    TextField("Ticker", text: $symbol).terminalInput().onSubmit(add)
                    Button("Add", action: add).disabled(model.watchlist.count >= 150)
                }
                if invalid { Text("Enter a valid ticker.").foregroundStyle(.red) }
            }
            ForEach(model.watchlist, id: \.self) { symbol in
                NavigationLink { ResearchView(symbol: symbol) } label: {
                    if let quote = model.quotes.first(where: { $0.symbol == symbol }) { QuoteRow(quote: quote) }
                    else { HStack { Text(symbol); Spacer(); Text("—").foregroundStyle(.secondary) } }
                }
            }.onDelete { offsets in model.setWatchlist(model.watchlist.enumerated().filter { !offsets.contains($0.offset) }.map(\.element)); Task { await model.refresh() } }
            if model.watchlist.isEmpty { Text("Your watchlist is empty.").foregroundStyle(.secondary) }
        }.refreshable { await model.refresh() }
    }
    private func add() {
        guard let value = normalizedSymbol(symbol) else { invalid = true; return }
        model.setWatchlist(model.watchlist + [value]); symbol = ""; invalid = false
        Task { await model.refresh() }
    }
}
private struct HoldingsView: View {
    @EnvironmentObject private var model: TerminalModel
    var body: some View {
        List {
            if !model.portfolios.isEmpty {
                Picker("Portfolio account", selection: $model.portfolioID) { ForEach(model.portfolios) { Text($0.name).tag(Optional($0.id)) } }
                    .onChange(of: model.portfolioID) { _, _ in Task { await model.refreshHoldings() } }
            }
            Section("Positions · USD") {
                LabeledContent("Market value", value: number(model.valuation?.marketValue))
                LabeledContent("Unrealized P&L", value: number(model.valuation?.unrealized))
                Text("Excludes cash. Incomplete valuations are withheld.").font(.caption).foregroundStyle(.secondary)
                if let missing = model.valuation?.missingSymbols, !missing.isEmpty { Text("Missing fresh USD quotes: \(missing.joined(separator: ", "))").foregroundStyle(.orange) }
            }
            ForEach(model.positions) { position in
                NavigationLink { ResearchView(symbol: position.symbol) } label: {
                    VStack(alignment: .leading) { Text(position.symbol).font(.headline); Text("\(position.quantity.formatted()) shares · average cost \(number(position.avgCost))").font(.callout).foregroundStyle(.secondary) }
                }
            }
            if model.holdingsReady && model.positions.isEmpty { Text("No holdings yet.") }
            if let server = model.server { Section { Link("Manage transactions in the web terminal", destination: server.origin) } }
        }.refreshable { await model.refresh() }
    }
}
private struct AlertsView: View {
    @EnvironmentObject private var model: TerminalModel
    @ViewState<Bool> private var create = false
    var body: some View {
        List {
            Section {
                Button("Create price alert") { create = true }
                Text("Rules are checked by your running server. Native background push is not configured by this app; use the installed web app for Web Push.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(model.alerts) { rule in
                VStack(alignment: .leading, spacing: 8) {
                    Text(rule.label.isEmpty ? rule.symbol : rule.label).font(.headline)
                    Text("\(rule.symbol) · \(rule.condition) · \(number(rule.threshold))").font(.callout)
                    Button(rule.armed == 0 ? "Rearm" : "Pause") { Task { await model.setArmed(rule) } }
                }.padding(.vertical, 4)
            }
            if model.alerts.isEmpty { Text("No alerts yet.") }
        }.refreshable { await model.refresh() }.sheet(isPresented: $create) { AlertEditor() }
    }
}
private struct AlertEditor: View {
    @EnvironmentObject private var model: TerminalModel
    @Environment(\.dismiss) private var dismiss
    @ViewState<String> private var symbol = ""
    @ViewState<String> private var threshold = ""
    @ViewState<String> private var label = ""
    @ViewState<String> private var condition = "PRICE_ABOVE"
    @ViewState<Bool> private var saving = false
    @ViewState<String?> private var error = nil
    var body: some View {
        NavigationStack {
            Form {
                TextField("Ticker", text: $symbol).terminalInput()
                Picker("Condition", selection: $condition) { Text("Price ≥").tag("PRICE_ABOVE"); Text("Price ≤").tag("PRICE_BELOW") }
                TextField("Threshold", text: $threshold)
                TextField("Label (optional)", text: $label)
                if let error { Text(error).foregroundStyle(.red) }
                Button(saving ? "Saving…" : "Save alert") { Task { await save() } }.disabled(saving)
            }.navigationTitle("New alert").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) } }
        }
    }
    private func save() async {
        guard let symbol = normalizedSymbol(symbol), let value = Double(threshold), value.isFinite, value > 0, let api = model.api else { error = "Enter a valid ticker and positive price."; return }
        saving = true; defer { saving = false }
        do { let _: Acknowledgement = try await api.post("/api/alerts", body: AlertInput(symbol: symbol, condition: condition, threshold: value, label: String(label.prefix(120)))); await model.refresh(); dismiss() }
        catch { self.error = error.localizedDescription; if error as? ConnectionError == .unauthorized { await model.report(error) } }
    }
}
private struct SettingsView: View {
    @EnvironmentObject private var model: TerminalModel
    @Environment(\.dismiss) private var dismiss
    @ViewState<SharedWorkspace?> private var selected = nil
    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    Text(model.server?.origin.absoluteString ?? "").textSelection(.enabled)
                    if let server = model.server { Link("Open full web terminal", destination: server.origin) }
                    Button("Sign out", role: .destructive) { dismiss(); Task { await model.signOut() } }
                }
                Section("Saved web layouts") {
                    Button("Load published layouts") { Task { await model.loadWorkspaces() } }
                    ForEach(model.workspaces) { workspace in Button(workspace.name) { selected = workspace } }
                    Text("Upload a reviewed snapshot from the web Sync panel first. Importing a watchlist replaces only this device's list; web layouts and records stay on the server.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Privacy") { Text("Passwords, session cookies and account responses are not stored on disk. Only the server address and a server-specific watchlist are saved locally. Background app previews are covered. The server's 12-hour session expiry still applies.").font(.callout) }
            }.navigationTitle("Settings").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .confirmationDialog("Replace this device's watchlist?", isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } }), titleVisibility: .visible) {
                    Button("Import watchlist") { if let selected { model.setWatchlist(selected.watchlist); Task { await model.refresh() } }; selected = nil }
                    Button("Cancel", role: .cancel) { selected = nil }
                }
        }
    }
}
