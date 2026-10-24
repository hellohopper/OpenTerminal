import SwiftUI
import Charts
import OpenTerminalCore

struct ResearchView: View {
    @EnvironmentObject private var model: TerminalModel
    let symbol: String
    @ViewState<Quote?> private var quote = nil
    @ViewState<[Candle]> private var candles = []
    @ViewState<[NewsItem]> private var news = []
    @ViewState<[JournalEntry]> private var notes = []
    @ViewState<String> private var range = "6M"
    @ViewState<String> private var title = ""
    @ViewState<String> private var bodyText = ""
    @ViewState<Bool> private var loading = false
    @ViewState<Bool> private var saving = false
    @ViewState<String?> private var error = nil
    @ViewState<String?> private var message = nil
    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(.orange); Button("Retry") { Task { await load() } } } }
            if let quote {
                Section { QuoteRow(quote: quote); Text("\(quote.currency ?? "—") · \(quote.source) · retrieved \(quote.retrievedAt ?? "unknown")").font(.caption).foregroundStyle(.secondary) }
            }
            Section("Price chart") {
                Picker("Range", selection: $range) { ForEach(["1M", "6M", "1Y", "5Y"], id: \.self) { Text($0) } }.pickerStyle(.segmented)
                if loading { ProgressView() }
                if !candles.isEmpty {
                    Chart(candles) { point in LineMark(x: .value("Date", point.date), y: .value("Close", point.close)).foregroundStyle(.orange) }
                        .frame(height: 220).chartYScale(domain: .automatic(includesZero: false))
                        .accessibilityLabel("\(symbol) closing prices, \(range)")
                }
            }
            Section("News") {
                ForEach(news.prefix(10)) { item in if let url = item.url { Link(destination: url) { VStack(alignment: .leading) { Text(item.title); Text(item.publisher).font(.caption).foregroundStyle(.secondary) } } } }
                if news.isEmpty && !loading { Text("No headlines available.").foregroundStyle(.secondary) }
            }
            Section("Research notes") {
                ForEach(notes) { note in VStack(alignment: .leading, spacing: 6) { Text(note.title).font(.headline); Text(note.body).font(.callout) } }
                TextField("Note title", text: $title)
                TextEditor(text: $bodyText).frame(minHeight: 100).accessibilityLabel("Note body")
                Button(saving ? "Saving…" : "Save note") { Task { await saveNote() } }.disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let message { Text(message).foregroundStyle(.secondary) }
            }
            if let server = model.server {
                Section { Link("Full company research", destination: server.researchURL(symbol: symbol)); ShareLink("Share research link", item: server.researchURL(symbol: symbol)) }
            }
        }.navigationTitle(symbol)
            .refreshable { await load() }
            .task(id: range) { await load() }
    }
    private func load() async {
        guard let api = model.api else { return }
        let selectedRange = range; loading = true; error = nil; candles = []
        defer { if range == selectedRange { loading = false } }
        // Provider failures must not prevent access to private notes or other sections.
        for section in ["quote", "chart", "news", "notes"] {
            guard !Task.isCancelled, selectedRange == range else { return }
            do {
                switch section {
                case "quote":
                    let values: [Quote] = try await api.get("/api/quotes", query: ["symbols": symbol])
                    guard !Task.isCancelled, selectedRange == range else { return }; quote = values.first
                case "chart":
                    let values: [Candle] = try await api.get("/api/history/\(symbol)", query: ["range": selectedRange])
                    guard !Task.isCancelled, selectedRange == range else { return }; candles = values.sorted { $0.time < $1.time }
                case "news":
                    let values: [NewsItem] = try await api.get("/api/news", query: ["symbol": symbol])
                    guard !Task.isCancelled, selectedRange == range else { return }; news = values
                default:
                    let values: JournalList = try await api.get("/api/journal", query: ["symbol": symbol, "kind": "research"])
                    guard !Task.isCancelled, selectedRange == range else { return }; notes = values.entries
                }
            } catch {
                guard !Task.isCancelled else { return }; self.error = error.localizedDescription
                if error as? ConnectionError == .unauthorized { await model.report(error); return }
            }
        }
    }
    private func saveNote() async {
        guard let api = model.api, !saving else { return }
        guard title.count <= 120 && bodyText.count <= 20000 else { error = "Use a title up to 120 characters and a note up to 20,000 characters."; return }
        saving = true; message = nil; defer { saving = false }
        do {
            let _: Acknowledgement = try await api.post("/api/journal", body: NoteInput(symbol: symbol, title: title.trimmingCharacters(in: .whitespacesAndNewlines), body: bodyText))
            title = ""; bodyText = ""; message = "Note saved."; await load()
        } catch { self.error = error.localizedDescription; if error as? ConnectionError == .unauthorized { await model.report(error) } }
    }
}
