import SwiftUI
import Charts
import OpenTerminalCore

struct ResearchView: View {
    @EnvironmentObject private var model: TerminalModel
    let symbol: String
    var isModal = false
    var body: some View { ResearchContent(terminal: model, symbol: symbol, isModal: isModal).id("\(model.sessionID):\(symbol)") }
}
private struct ResearchContent: View {
    @ObservedObject var terminal: TerminalModel
    @StateObject private var research: ResearchModel
    @Environment(\.dismiss) private var dismiss
    @ViewState<Bool> private var leaving = false
    let isModal: Bool
    init(terminal: TerminalModel, symbol: String, isModal: Bool) {
        self.terminal = terminal; self.isModal = isModal
        _research = StateObject(wrappedValue: ResearchModel(terminal: terminal, symbol: symbol))
    }
    private func status(_ section: ResearchSection) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if research.loading.contains(section) { ProgressView("Loading…") }
            if let error = research.errors[section] { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await research.load(section) } } }
            if let updated = research.updated[section] { Text("Updated \(updated.formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
        }
    }
    var body: some View {
        List {
            Section("Quote") {
                status(.quote)
                if let quote = research.quote { QuoteRow(quote: quote); Text("\(quote.currency ?? "—") · \(quote.source)").font(.caption).foregroundStyle(.secondary) }
            }
            Section("Price chart") {
                Picker("Range", selection: $research.range) { ForEach(["1M", "6M", "1Y", "5Y"], id: \.self) { Text($0) } }.pickerStyle(.segmented)
                status(.chart)
                if !research.candles.isEmpty {
                    Chart(research.candles) { point in LineMark(x: .value("Date", point.date), y: .value("Close", point.close)).foregroundStyle(.orange) }
                        .frame(height: 220).chartYScale(domain: .automatic(includesZero: false))
                        .accessibilityLabel("\(research.symbol) closing prices, \(research.range)")
                }
            }
            Section("News") {
                status(.news)
                ForEach(research.news.prefix(10)) { item in if let url = item.url { Link(destination: url) { VStack(alignment: .leading) { Text(item.title); Text(item.publisher).font(.caption).foregroundStyle(.secondary) } } } }
                if research.news.isEmpty && !research.loading.contains(.news) && research.errors[.news] == nil { Text("No headlines available.").foregroundStyle(.secondary) }
            }
            Section("Research notes") {
                status(.notes)
                ForEach(research.notes) { note in VStack(alignment: .leading, spacing: 6) { Text(note.title).font(.headline); Text(note.body).font(.callout) } }
                TextField("Note title", text: $research.title)
                TextEditor(text: $research.bodyText).frame(minHeight: 120).accessibilityLabel("Note body")
                Button(LocalizedStringKey(research.saving ? "Saving…" : "Save note")) { Task { await research.saveNote() } }.disabled(research.saving || research.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let error = research.saveError { Text(error).foregroundStyle(.orange) }
                if let message = research.message { Text(message).foregroundStyle(.secondary) }
                if research.hasDraft { Text("Draft kept in memory until sign-out or the app closes.").font(.caption).foregroundStyle(.secondary) }
            }
            if let server = terminal.server {
                Section { Link("Full company research", destination: server.researchURL(symbol: research.symbol)); ShareLink("Share research link", item: server.researchURL(symbol: research.symbol)) }
            }
        }.navigationTitle(research.symbol)
            .refreshable { await research.refresh() }
            .task { await research.refreshOverview() }
            .task(id: research.range) { await research.load(.chart) }
            .onChange(of: research.noteRevision) { _, _ in Task { await research.load(.notes) } }
            .interactiveDismissDisabled(research.hasDraft || research.saving)
            .terminalBackButtonHidden(research.hasDraft || research.saving)
            .toolbar {
                if isModal || research.hasDraft || research.saving {
                    ToolbarItem(placement: .cancellationAction) { Button(LocalizedStringKey(isModal ? "Close" : "Back")) { if research.hasDraft || research.saving { leaving = true } else { dismiss() } } }
                }
            }
            .confirmationDialog("Leave research?", isPresented: $leaving, titleVisibility: .visible) {
                Button("Keep draft and leave") { dismiss() }
                if !research.saving { Button("Discard draft and leave", role: .destructive) { research.discardDraft(); dismiss() } }
                Button("Stay", role: .cancel) {}
            } message: { Text(research.saving ? "Your note is still saving. Newer edits will remain in memory." : "Your draft will remain in memory. It is cleared on sign-out or when the app closes.") }
    }
}
extension View {
    @ViewBuilder func terminalBackButtonHidden(_ hidden: Bool) -> some View {
        #if os(iOS)
        navigationBarBackButtonHidden(hidden)
        #else
        self
        #endif
    }
}
