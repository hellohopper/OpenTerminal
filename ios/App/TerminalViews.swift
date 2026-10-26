import SwiftUI
import OpenTerminalCore

struct TerminalTabs: View {
    @EnvironmentObject private var model: TerminalModel
    @Environment(\.scenePhase) private var phase
    var body: some View {
        TabView(selection: $model.selectedTab) {
            TerminalPage(title: "Today") { TodayView() }.tabItem { Label("Today", systemImage: "sun.max") }.tag(TerminalTab.today)
            TerminalPage(title: "Watchlist") { WatchlistView() }.tabItem { Label("Watchlist", systemImage: "star") }.tag(TerminalTab.watchlist)
            TerminalPage(title: "Holdings") { HoldingsView() }.tabItem { Label("Holdings", systemImage: "chart.pie") }.tag(TerminalTab.holdings)
            TerminalPage(title: "Alerts") { AlertsView() }.tabItem { Label("Alerts", systemImage: "bell") }.tag(TerminalTab.alerts)
        }.task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(model.reconnecting ? model.retryDelay : 30)) } catch { break }
            }
        }.task(id: phase) {
            guard phase == .active else { return }
            await model.registerExistingPush()
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
            content.navigationTitle(LocalizedStringKey(title))
                .safeAreaInset(edge: .top) {
                    if let error = model.error ?? (model.sectionErrors.isEmpty ? nil : model.sectionErrors.keys.map { nativeText($0.rawValue) }.sorted().joined(separator: ", ") + ": " + nativeText("Data unavailable.")) {
                        HStack { VStack(alignment:.leading){Text(error).font(.callout);if model.reconnecting{Text("Reconnecting automatically…").font(.caption)}}; Spacer(); Button("Retry") { Task { await model.refresh() } } }
                            .padding().background(.orange.opacity(0.15)).accessibilityElement(children: .contain)
                    }
                }
                .toolbar { ToolbarItem(placement: .primaryAction) { Button { settings = true } label: { Label("Settings", systemImage: "gearshape") } } }
                .safeAreaInset(edge:.bottom){if let updated=model.lastUpdated{Text("Last updated \(updated.formatted(date:.omitted,time:.shortened))").font(.caption).foregroundStyle(.secondary).padding(.vertical,4)}}
                .sheet(isPresented: $settings) { SettingsView() }
        }
    }
}
private struct TodayView: View {
    @EnvironmentObject private var model: TerminalModel
    var body: some View {
        List {
            Section { DataSectionStatus(section: .briefing); DataSectionStatus(section: .holdings) }
            if let briefing = model.briefing {
                Section(briefing.date) { Text(briefing.summary) }
                Section("Market") { ForEach(briefing.indexes) { QuoteRow(quote: $0) } }
                Section("Headlines") { ForEach(briefing.headlines.prefix(5)) { item in if let url = item.url { Link(item.title, destination: url) } } }
                if !briefing.warnings.isEmpty { Section("Data coverage") { ForEach(briefing.warnings, id: \.self) { Text($0).font(.callout).foregroundStyle(.secondary) } } }
            } else if !model.loadingSections.contains(.briefing) && model.sectionErrors[.briefing] == nil { Section { Text("Add symbols to your watchlist and pull to refresh your briefing.") } }
            Section("Your holdings") {
                if let account = model.selectedPortfolio { LabeledContent("Portfolio account", value: account.name) }
                else if !model.loadingSections.contains(.holdings) { Text("No portfolio selected.").foregroundStyle(.secondary) }
                LabeledContent("Position value", value: number(model.valuation?.marketValue))
                LabeledContent("Unrealized P&L", value: number(model.valuation?.unrealized))
                Text("Positions only; excludes cash. Missing, stale or unverified USD quotes withhold totals.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Alerts") { Text("\(model.alerts.filter { $0.armed != 0 }.count) active alerts") }
        }.refreshable { await model.refresh() }
    }
}
private struct DataSectionStatus: View {
    @EnvironmentObject private var model: TerminalModel
    let section: DataSection
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if model.loadingSections.contains(section) { ProgressView("Loading…") }
            if let error = model.sectionErrors[section] { Text("\(nativeText(section.rawValue)): \(error)").foregroundStyle(.orange).font(.callout) }
            if let updated = model.sectionUpdated[section] { Text("\(nativeText(section.rawValue)) updated \(updated.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
        }
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
    @ViewState<Bool> private var manage = false
    var body: some View {
        List {
            Section {
                DataSectionStatus(section: .watchlist)
                if !model.sharedLists.isEmpty {
                    Picker("Shared watchlist",selection:Binding(get:{model.sharedListID ?? 0},set:{model.chooseList($0)})){ForEach(model.sharedLists){Text($0.payload.name).tag($0.id)}}
                }
                Button("Manage shared lists") { manage = true }
                if let error = model.listManagementError { Text(error).foregroundStyle(.orange) }
                HStack {
                    TextField("Ticker", text: $symbol).terminalInput(ticker: true).onSubmit(add)
                    Button("Add", action: add).disabled(model.watchlist.count >= 150 || model.sharedListID == nil)
                }
                if invalid { Text("Enter a valid ticker.").foregroundStyle(.red) }
            }
            ForEach(model.watchlist, id: \.self) { symbol in
                NavigationLink { ResearchView(symbol: symbol) } label: {
                    if let quote = model.quotes.first(where: { $0.symbol == symbol }) { QuoteRow(quote: quote) }
                    else { HStack { Text(symbol); Spacer(); Text("—").foregroundStyle(.secondary) } }
                }.contextMenu {
                    Button("Move up") { Task { await model.moveSymbol(symbol, direction: -1) } }.disabled(model.managingLists || model.watchlist.first == symbol)
                    Button("Move down") { Task { await model.moveSymbol(symbol, direction: 1) } }.disabled(model.managingLists || model.watchlist.last == symbol)
                }
            }.onDelete { offsets in let symbols=offsets.map{model.watchlist[$0]};Task{for symbol in symbols{await model.changeSymbol(symbol,action:"remove")}} }
            if model.watchlist.isEmpty && !model.loadingSections.contains(.watchlist) && model.sectionErrors[.watchlist] == nil { Text("Your watchlist is empty.").foregroundStyle(.secondary) }
        }.refreshable { await model.refresh() }.sheet(isPresented: $manage) { SharedListsView() }
    }
    private func add() {
        guard let value = normalizedSymbol(symbol) else { invalid = true; return }
        symbol = ""; invalid = false
        Task { await model.changeSymbol(value,action:"add") }
    }
}
private struct SharedListsView: View {
    @EnvironmentObject private var model: TerminalModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @ViewState<String> private var name = ""
    @ViewState<SharedWatchlist?> private var renaming = nil
    @ViewState<SharedWatchlist?> private var deleting = nil
    @ViewState<String> private var renamed = ""
    private var actionLayout: AnyLayout { typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout()) }
    var body: some View {
        NavigationStack {
            Form {
                Section("New shared list") {
                    TextField("List name", text: $name)
                    Button("Create empty list") { Task { if await model.createList(name: name) { name = "" } } }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.managingLists)
                    Button("Copy current list") { Task { if await model.createList(name: name, copyCurrent: true) { name = "" } } }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.managingLists || model.sharedListID == nil)
                }
                if let error = model.listManagementError { Section { Text(error).foregroundStyle(.orange) } }
                Section("Shared on all devices") {
                    ForEach(model.sharedLists) { row in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(row.payload.name).font(.headline)
                            Text("\(row.payload.symbols.count) symbols").font(.caption).foregroundStyle(.secondary)
                            actionLayout {
                                Button { Task { await model.moveList(row, direction: "up") } } label: { Image(systemName: "arrow.up") }.accessibilityLabel("Move up \(row.payload.name)").disabled(model.sharedLists.first?.id == row.id)
                                Button { Task { await model.moveList(row, direction: "down") } } label: { Image(systemName: "arrow.down") }.accessibilityLabel("Move down \(row.payload.name)").disabled(model.sharedLists.last?.id == row.id)
                                Button("Rename") { renamed = row.payload.name; renaming = row }
                                Button("Delete", role: .destructive) { deleting = row }
                            }.buttonStyle(.borderless).disabled(model.managingLists)
                        }
                    }
                    Text("Order syncs to the web terminal. Long-press a symbol in Watchlist to move it up or down.").font(.caption).foregroundStyle(.secondary)
                }
            }.navigationTitle("Shared watchlists")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .alert("Rename shared list", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                    TextField("New list name", text: $renamed)
                    Button("Save") { if let row = renaming { let value = renamed; Task { await model.renameList(row, name: value) } }; renaming = nil }
                    Button("Cancel", role: .cancel) { renaming = nil }
                }
                .confirmationDialog("Delete \(deleting?.payload.name ?? "shared list") from every device?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                    Button("Delete shared list", role: .destructive) { if let row = deleting { Task { await model.deleteList(row) } }; deleting = nil }
                    Button("Cancel", role: .cancel) { deleting = nil }
                } message: { Text("Local web workspace lists are preserved.") }
        }
    }
}
private struct HoldingsView: View {
    @EnvironmentObject private var model: TerminalModel
    var body: some View {
        List {
            if !model.portfolios.isEmpty {
                Picker("Portfolio account", selection: Binding(get: { model.portfolioID }, set: { model.choosePortfolio($0) })) { ForEach(model.portfolios) { Text($0.name).tag(Optional($0.id)) } }
            }
            Section("Positions · USD") {
                DataSectionStatus(section: .holdings)
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
                DataSectionStatus(section: .alerts)
                Button("Create price alert") { create = true }
                Text("Rules are checked by your running Mac. Enable native notifications in Settings after configuring APNs on the server.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(model.alerts) { rule in
                VStack(alignment: .leading, spacing: 8) {
                    Text(rule.label.isEmpty ? rule.symbol : rule.label).font(.headline)
                    Text("\(rule.symbol) · \(rule.condition) · \(number(rule.threshold))").font(.callout)
                    Button(LocalizedStringKey(rule.armed == 0 ? "Rearm" : "Pause")) { Task { await model.setArmed(rule) } }
                }.padding(.vertical, 4)
            }
            if model.alerts.isEmpty && !model.loadingSections.contains(.alerts) && model.sectionErrors[.alerts] == nil { Text("No alerts yet.") }
        }.refreshable { await model.refresh() }.sheet(isPresented: $create) { AlertEditor(state: model.alertEditor) }
    }
}
private struct AlertEditor: View {
    @EnvironmentObject private var model: TerminalModel
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var state: AlertEditorState
    @ViewState<Bool> private var leaving = false
    var body: some View {
        NavigationStack {
            Form {
                TextField("Ticker", text: $state.draft.symbol).terminalInput(ticker: true)
                Picker("Condition", selection: $state.draft.condition) { Text("Price ≥").tag("PRICE_ABOVE"); Text("Price ≤").tag("PRICE_BELOW") }
                TextField("Threshold", text: $state.draft.threshold).terminalPriceInput()
                TextField("Label (optional)", text: $state.draft.label)
                if let error = state.error { Text(error).foregroundStyle(.red) }
                if let message = state.message { Text(message).foregroundStyle(.secondary) }
                if state.hasDraft { Text("Draft kept in memory until sign-out or the app closes.").font(.caption).foregroundStyle(.secondary) }
                Button(LocalizedStringKey(state.saving ? "Saving…" : "Save alert")) { Task { await model.saveAlert(state) } }.disabled(state.saving)
            }.navigationTitle("New alert")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { if state.hasDraft || state.saving { leaving = true } else { dismiss() } } } }
                .interactiveDismissDisabled(state.hasDraft || state.saving)
                .onChange(of: state.savedRevision) { _, _ in
                    if model.signedIn, state === model.alertEditor, !state.hasDraft { dismiss() }
                }
                .confirmationDialog("Leave alert?", isPresented: $leaving, titleVisibility: .visible) {
                    Button("Keep draft and leave") { dismiss() }
                    if !state.saving { Button("Discard draft and leave", role: .destructive) { state.discard(); dismiss() } }
                    Button("Stay", role: .cancel) {}
                } message: {
                    Text(LocalizedStringKey(state.saving ? "Your alert is still saving. Newer edits will remain in memory." : "Your draft will remain in memory. It is cleared on sign-out or when the app closes."))
                }
        }
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
                Section("Server health") {
                    Button("Check server health") { Task { await model.checkHealth() } }.disabled(model.checkingHealth)
                    if model.checkingHealth { ProgressView("Checking…") }
                    ForEach(["Connection", "Backups", "Native push"], id: \.self) { name in
                        if let message = model.health[name] { VStack(alignment: .leading) { Text(LocalizedStringKey(name)).font(.headline); Text(message).font(.callout) } }
                    }
                }
                Section("Saved web layouts") {
                    Button("Load published layouts") { Task { await model.loadWorkspaces() } }
                    ForEach(model.workspaces) { workspace in Button(workspace.name) { selected = workspace } }
                    Text("Upload a reviewed snapshot from the web Sync panel first. Importing replaces the selected shared watchlist on the server; other web layouts are preserved.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Native notifications") {
                    Button("Enable native notifications") { Task { await model.enableNotifications() } }.disabled(model.registeringPush)
                    if model.registeringPush { ProgressView().accessibilityLabel("Registering this phone…") }
                    if let message = model.pushMessage { Text(message).font(.callout) }
                }
                Section("Paired devices"){Button("Refresh devices"){Task{await model.loadDevices()}};ForEach(model.devices){device in HStack{Text(device.name);Spacer();Button(LocalizedStringKey(device.revoked_at == nil ? "Revoke" : "Revoked"),role:.destructive){Task{await model.revoke(device.id)}}.disabled(device.revoked_at != nil)}}}
                Section("Privacy") { Text("The owner password and account responses are never persisted. Remember this device stores only its revocable authorization token in this phone’s Keychain. Tokens expire after 30 days of inactivity and renew while the app is used.").font(.callout) }
            }.navigationTitle("Settings").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .confirmationDialog("Replace the selected shared watchlist on all devices?", isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } }), titleVisibility: .visible) {
                    Button("Import watchlist") { if let selected { Task { await model.replaceWatchlist(selected.watchlist) } }; selected = nil }
                    Button("Cancel", role: .cancel) { selected = nil }
                }
        }
    }
}
