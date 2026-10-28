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
    var showsUpdated = true
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if model.loadingSections.contains(section) { ProgressView("Loading…") }
            if let error = model.sectionErrors[section] { Text("\(nativeText(section.rawValue)): \(error)").foregroundStyle(.orange).font(.callout) }
            if showsUpdated, let updated = model.sectionUpdated[section] { Text("\(nativeText(section.rawValue)) updated \(updated.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
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
    @Environment(\.locale) private var locale
    @ViewState<Bool> private var create = false
    @ViewState<(rule: AlertRule, session: UUID)?> private var deleting = nil
    var body: some View {
        List {
            Section {
                Button("Create alert") { create = true }
                NavigationLink("Trigger history") { AlertHistoryView(terminal: model).id(model.sessionID) }
                Text("Rules are checked by your running Mac. Enable native notifications in Settings after configuring APNs on the server.").font(.caption).foregroundStyle(.secondary)
            }
            AlertMonitorSection()
            ForEach(model.alerts) { rule in
                VStack(alignment: .leading, spacing: 8) {
                    Text(rule.label.isEmpty ? rule.symbol : rule.label).font(.headline)
                    Text("\(rule.symbol) · \(nativeText(rule.conditionLabelKey)) · \(alertValueText(rule.threshold, kind: rule.valueKind, locale: locale))").font(.callout)
                    AlertRuleStatus(rule: rule)
                    HStack {
                        Button(LocalizedStringKey(rule.armed == 0 ? "Rearm" : "Pause")) {
                            let session = model.sessionID
                            Task { await model.setArmed(rule, session: session) }
                        }
                        Button("Delete", role: .destructive) { deleting = (rule, model.sessionID) }
                    }.buttonStyle(.borderless).disabled(model.pendingAlertActions.contains(rule.id))
                    if model.pendingAlertActions.contains(rule.id) { ProgressView("Updating alert…") }
                    if let error = model.alertActionErrors[rule.id] {
                        Text(error).font(.callout).foregroundStyle(.red)
                        Button("Refresh alerts") { Task { await model.refreshAlerts() } }.buttonStyle(.borderless)
                            .disabled(model.loadingSections.contains(.alerts))
                    }
                }.padding(.vertical, 4)
            }
            if model.alerts.isEmpty && !model.loadingSections.contains(.alerts) && model.sectionErrors[.alerts] == nil { Text("No alerts yet.") }
        }.refreshable { await model.refreshAlerts() }.sheet(isPresented: $create) { AlertEditor(state: model.alertEditor) }
            .onChange(of: model.sessionID) { _, _ in deleting = nil }
            .confirmationDialog("Delete alert?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete alert", role: .destructive) {
                    if let target = deleting { Task { await model.deleteAlert(target.rule, session: target.session) } }
                    deleting = nil
                }
                Button("Cancel", role: .cancel) { deleting = nil }
            } message: {
                if let rule = deleting?.rule {
                    Text("\(rule.label.isEmpty ? rule.symbol : rule.label) · \(rule.symbol) · \(nativeText(rule.conditionLabelKey)) · \(alertValueText(rule.threshold, kind: rule.valueKind, locale: locale))\n\n\(nativeText("This removes the shared alert from the Mac and every connected device."))")
                }
            }
    }
}
private struct AlertMonitorSection: View {
    @EnvironmentObject private var model: TerminalModel
    var body: some View {
        Section {
            DataSectionStatus(section: .alerts, showsUpdated: false)
            Button("Refresh alerts") { Task { await model.refreshAlerts() } }.disabled(model.loadingSections.contains(.alerts))
            if let monitor = model.alertMonitor {
                LabeledContent("Status at last refresh", value: nativeText(monitor.stateLabelKey))
                if let received = model.alertMonitorReceivedAt { Text("Status received \(received.formatted(date: .abbreviated, time: .standard))").font(.caption).foregroundStyle(.secondary) }
                if model.sectionErrors[.alerts] != nil { Text("Showing the last received monitor status.").foregroundStyle(.orange) }
                if monitor.running == false { Text("The Mac is not scheduling alert checks.").foregroundStyle(.orange) }
                if let seconds = monitor.intervalSeconds { Text("Check interval: \(seconds.formatted()) seconds").font(.caption) }
                if let date = monitor.lastAttempt { Text("Last check attempt \(date.formatted(date: .abbreviated, time: .standard))").font(.caption) }
                else { Text("No check time available in this server run.").font(.caption).foregroundStyle(.secondary) }
                if let error = monitor.lastError, !error.isEmpty { Text("Last reported check issue: \(error)").font(.callout).foregroundStyle(.orange) }
                if let missing = monitor.missingSymbols, !missing.isEmpty { Text("Missing quotes at last check: \(missing.joined(separator: ", "))").font(.callout).foregroundStyle(.orange) }
            } else if model.sectionUpdated[.alerts] != nil { Text("Monitor status unavailable.").foregroundStyle(.secondary) }
        } header: { Text("Mac alert monitor") } footer: {
            Text("This snapshot describes the Mac at the last refresh. Check times record attempts; successful rule evaluations appear below. Polling can miss moves between checks.")
        }
    }
}
private struct AlertRuleStatus: View {
    let rule: AlertRule
    @Environment(\.locale) private var locale
    var body: some View {
        DisclosureGroup("Check details") {
            LabeledContent("Rule status", value: nativeText(rule.armed == 0 ? "Not armed" : "Armed"))
            if let date = rule.lastEvaluation { Text("Last evaluated \(date.formatted(date: .abbreviated, time: .standard))") }
            else { Text("No evaluation time available.").foregroundStyle(.secondary) }
            LabeledContent("Last evaluated value", value: rule.last_value.map { alertValueText($0, kind: rule.valueKind, locale: locale) } ?? "—")
            if let date = rule.lastTrigger { Text("Last trigger recorded \(date.formatted(date: .abbreviated, time: .standard))") }
            else { Text("No trigger time available.").foregroundStyle(.secondary) }
        }.font(.caption)
    }
}
private struct AlertHistoryView: View {
    @StateObject private var history: AlertHistoryModel
    @Environment(\.locale) private var locale
    init(terminal: TerminalModel) { _history = StateObject(wrappedValue: AlertHistoryModel(terminal: terminal)) }
    var body: some View {
        List {
            Section {
                Button("Refresh history") { Task { await history.loadLatest() } }.disabled(history.loadingLatest)
                if history.loadingLatest { ProgressView("Loading history…") }
                if let error = history.error { Text(error).foregroundStyle(.red) }
                if let updated = history.updated { Text("Updated \(updated.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
            } footer: {
                Text("History shows checks recorded by the Mac. Offline periods cannot be reconstructed.")
            }
            ForEach(history.events) { event in
                Section {
                    if let symbol = normalizedSymbol(event.symbol) {
                        NavigationLink { ResearchView(symbol: symbol) } label: {
                            Text(event.label.isEmpty ? event.symbol : event.label).font(.headline)
                        }
                    } else { Text(event.label.isEmpty ? event.symbol : event.label).font(.headline) }
                    Text("\(event.symbol) · \(nativeText(event.conditionLabelKey)) \(alertValueText(event.threshold, kind: event.valueKind, currency: event.currency, locale: locale))").font(.callout)
                    LabeledContent("Triggered value", value: alertValueText(event.value, kind: event.valueKind, currency: event.currency, locale: locale))
                    if event.valueKind != .price {
                        LabeledContent("Quote price", value: alertValueText(event.price, kind: .price, currency: event.currency, locale: locale))
                    }
                    if event.alert_id == nil { Text("Original rule deleted.").font(.caption).foregroundStyle(.secondary) }
                    Group {
                        if let date = event.recordedAt { Text("Recorded \(date.formatted(date: .abbreviated, time: .standard))") }
                        else { Text("Recorded time unavailable.") }
                        if let date = event.observedAt { Text("Quote observed \(date.formatted(date: .abbreviated, time: .standard))") }
                        else { Text("Quote time unavailable.") }
                        Text(event.source)
                    }.font(.caption).foregroundStyle(.secondary)
                }
            }
            if history.hasLoaded && history.events.isEmpty && !history.loadingLatest && history.error == nil { Text("No recorded triggers yet.") }
            if history.loadingMore { ProgressView("Loading older triggers…") }
            if let error = history.pageError { Text(error).foregroundStyle(.red) }
            if history.nextCursor != nil {
                Button(LocalizedStringKey(history.pageError == nil ? "Load older triggers" : "Retry older triggers")) { Task { await history.loadMore() } }
                    .disabled(history.loadingLatest || history.loadingMore)
            }
        }.navigationTitle("Trigger history")
            .refreshable { await history.loadLatest() }
            .task { if !history.hasLoaded { await history.loadLatest() } }
    }
}
private struct AlertEditor: View {
    @EnvironmentObject private var model: TerminalModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @ObservedObject var state: AlertEditorState
    @ViewState<Bool> private var leaving = false
    var body: some View {
        let trigger = state.draft.trigger ?? .priceAbove
        NavigationStack {
            Form {
                TextField("Ticker", text: $state.draft.symbol).terminalInput(ticker: true)
                Picker("Alert type", selection: Binding(get: { state.draft.trigger ?? .priceAbove }, set: { state.selectTrigger($0) })) {
                    ForEach(AlertTrigger.allCases, id: \.self) { Text(LocalizedStringKey($0.labelKey)).tag($0) }
                }
                TextField(LocalizedStringKey(trigger.thresholdLabelKey), text: $state.draft.threshold).terminalPriceInput(signed: trigger.allowsNegativeInput)
                Text(nativeText(trigger.hintKey).replacingOccurrences(of: "%@", with: trigger.example(locale: locale))).font(.caption).foregroundStyle(.secondary)
                Text("Changing the alert type clears the threshold. Each alert fires once; rearm it to check again.").font(.caption).foregroundStyle(.secondary)
                TextField("Label (optional)", text: $state.draft.label)
                if let error = state.error { Text(error).foregroundStyle(.red) }
                if let message = state.message { Text(message).foregroundStyle(.secondary) }
                if state.hasDraft { Text("Draft kept in memory until sign-out or the app closes.").font(.caption).foregroundStyle(.secondary) }
                Button(LocalizedStringKey(state.saving ? "Saving…" : "Save alert")) { Task { await model.saveAlert(state, locale: locale) } }.disabled(state.saving)
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
    @ViewState<WatchlistImportPlan?> private var selected = nil
    @ViewState<(device: MobileDeviceInfo, session: UUID)?> private var revoking = nil
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
                    Button("Load published layouts") { let session = model.sessionID; Task { await model.loadWorkspaces(session: session) } }.disabled(model.loadingWorkspaces || model.importingWorkspace)
                    if model.loadingWorkspaces { ProgressView("Loading published layouts…") }
                    if let error = model.workspaceLoadError { Text(error).font(.callout).foregroundStyle(.red) }
                    ForEach(model.workspaces) { workspace in
                        Button(workspace.name) { selected = model.prepareWorkspaceImport(workspace) }
                            .disabled(model.loadingWorkspaces || model.importingWorkspace || model.managingLists || model.sharedListID == nil)
                    }
                    if model.workspacesLoaded && model.workspaces.isEmpty && !model.loadingWorkspaces && model.workspaceLoadError == nil { Text("No published layouts yet.").foregroundStyle(.secondary) }
                    if model.sharedListID == nil { Text("Choose a shared watchlist before importing a layout.").font(.caption).foregroundStyle(.secondary) }
                    if model.importingWorkspace { ProgressView("Importing watchlist…") }
                    if let error = model.workspaceImportError { Text(error).font(.callout).foregroundStyle(.red) }
                    if let message = model.workspaceImportMessage { Text(message).font(.callout).foregroundStyle(.secondary) }
                    Text("Upload a reviewed snapshot from the web Sync panel first. Importing replaces the selected shared watchlist on the server; other web layouts are preserved.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Native notifications") {
                    Button("Enable native notifications") { Task { await model.enableNotifications() } }.disabled(model.registeringPush)
                    if model.registeringPush { ProgressView().accessibilityLabel("Registering this phone…") }
                    if let message = model.pushMessage { Text(message).font(.callout) }
                }
                Section("Paired devices") {
                    Button("Refresh devices") { let session = model.sessionID; Task { await model.loadDevices(session: session) } }.disabled(model.loadingDevices)
                    if model.loadingDevices { ProgressView("Loading devices…") }
                    if let error = model.deviceListError { Text(error).font(.callout).foregroundStyle(.red) }
                    ForEach(model.devices) { device in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(device.name)
                                    if device.id == model.currentDeviceID { Text("This device").font(.caption).foregroundStyle(.secondary) }
                                }
                                Spacer()
                                Button(LocalizedStringKey(device.revoked_at == nil ? "Revoke" : "Revoked"), role: .destructive) { revoking = (device, model.sessionID) }
                                    .buttonStyle(.borderless).disabled(device.revoked_at != nil || model.pendingDeviceRevocations.contains(device.id))
                            }
                            if model.pendingDeviceRevocations.contains(device.id) { ProgressView("Revoking device…") }
                            if let error = model.deviceActionErrors[device.id] { Text(error).font(.callout).foregroundStyle(.red) }
                        }
                    }
                }
                Section("Privacy") { Text("The owner password and account responses are never persisted. Remember this device stores only its revocable authorization token in this phone’s Keychain. Tokens expire after 30 days of inactivity and renew while the app is used.").font(.callout) }
            }.navigationTitle("Settings").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .confirmationDialog(LocalizedStringKey(selected?.symbols.isEmpty == true ? "Clear this shared watchlist?" : "Replace the selected shared watchlist on all devices?"), isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } }), titleVisibility: .visible) {
                    Button("Import watchlist") { if let selected { Task { await model.importWorkspace(selected) } }; selected = nil }
                    Button("Cancel", role: .cancel) { selected = nil }
                } message: {
                    if let plan = selected { Text("Import \(plan.symbols.count) symbols from “\(plan.workspace.name)” into “\(plan.target.payload.name)” on every connected device.") }
                }
                .onChange(of: model.sessionID) { _, _ in selected = nil; revoking = nil }
                .alert("Revoke device access?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } })) {
                    Button("Revoke", role: .destructive) {
                        if let target = revoking { Task { await model.revoke(target.device, session: target.session) } }
                        revoking = nil
                    }
                    Button("Cancel", role: .cancel) { revoking = nil }
                } message: {
                    if let device = revoking?.device {
                        Text("\(device.name)\n\n\(nativeText(device.id == model.currentDeviceID ? "Revoking this device signs you out. Pair it again with the OpenTerminal password to reconnect." : "This device will lose access to the Mac and stop receiving native notifications. Pair it again to reconnect."))")
                    }
                }
        }
    }
}
