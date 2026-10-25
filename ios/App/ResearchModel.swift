import Foundation
import SwiftUI
import Combine
import OpenTerminalCore

enum ResearchSection: String, CaseIterable { case quote = "Quote", chart = "Price chart", news = "News", notes = "Research notes" }
struct ResearchDraft: Equatable { var title = ""; var body = ""; var isEmpty: Bool { title.isEmpty && body.isEmpty } }
@MainActor final class ResearchNoteState: ObservableObject {
    @Published var title: String
    @Published var body: String
    @Published var saving = false
    @Published var message: String?
    @Published var error: String?
    @Published var savedRevision = 0
    init(_ draft: ResearchDraft) { title = draft.title; body = draft.body }
}

@MainActor final class ResearchModel: ObservableObject {
    @Published var quote: Quote?
    @Published var candles: [Candle] = []
    @Published var news: [NewsItem] = []
    @Published var notes: [JournalEntry] = []
    @Published var noteSearch = "" { didSet { noteSearchError = nil } }
    @Published private(set) var notesQuery = ""
    @Published private(set) var nextNoteCursor: Int?
    @Published private(set) var loadingMoreNotes = false
    @Published private(set) var notePageError: String?
    @Published private(set) var noteSearchError: String?
    @Published var range = "6M" { didSet { if current { terminal.rememberChartRange(range) } } }
    @Published var loading: Set<ResearchSection> = []
    @Published var errors: [ResearchSection: String] = [:]
    @Published var updated: [ResearchSection: Date] = [:]
    var title: String { get { noteState.title } set { noteState.title = newValue; keepDraft() } }
    var bodyText: String { get { noteState.body } set { noteState.body = newValue; keepDraft() } }
    var saving: Bool { get { noteState.saving } set { noteState.saving = newValue } }
    var message: String? { get { noteState.message } set { noteState.message = newValue } }
    var saveError: String? { get { noteState.error } set { noteState.error = newValue } }
    var noteRevision: Int { noteState.savedRevision }
    let symbol: String
    private let terminal: TerminalModel
    private let session: UUID
    private let draftKey: String
    private let noteState: ResearchNoteState
    private var noteUpdates: AnyCancellable?
    private var requests: [ResearchSection: UUID] = [:]
    var hasDraft: Bool { !draft.isEmpty }
    private var draft: ResearchDraft { ResearchDraft(title: title, body: bodyText) }

    init(terminal: TerminalModel, symbol: String) {
        self.terminal = terminal; self.symbol = symbol; session = terminal.sessionID
        draftKey = "\(terminal.server?.origin.absoluteString ?? "")|\(symbol)"
        let state = terminal.researchNoteStates[draftKey] ?? ResearchNoteState(terminal.researchDrafts[draftKey] ?? ResearchDraft())
        terminal.researchNoteStates[draftKey] = state; noteState = state
        range = terminal.preferredChartRange
        noteUpdates = state.objectWillChange.sink { [weak self] in self?.objectWillChange.send() }
    }
    private var current: Bool { terminal.sessionID == session && terminal.signedIn }
    private func keepDraft() { if current { terminal.researchDrafts[draftKey] = draft.isEmpty ? nil : draft } }
    func discardDraft() { title = ""; bodyText = ""; message = nil; saveError = nil }
    func refreshOverview() async {
        async let quote: Void = load(.quote)
        async let news: Void = load(.news)
        async let notes: Void = load(.notes)
        _ = await (quote, news, notes)
    }
    func refresh() async {
        async let overview: Void = refreshOverview()
        async let chart: Void = load(.chart)
        _ = await (overview, chart)
    }
    func load(_ section: ResearchSection) async {
        if section == .notes { await loadNotes(); return }
        guard current, let api = terminal.api else { return }
        let request = UUID(), selectedRange = range
        requests[section] = request; loading.insert(section); errors[section] = nil
        if section == .chart && loadedRange != selectedRange { candles = []; updated[.chart] = nil }
        defer { if requests[section] == request { loading.remove(section) } }
        func accept() -> Bool { current && !Task.isCancelled && requests[section] == request && (section != .chart || selectedRange == range) }
        do {
            switch section {
            case .quote:
                let values: [Quote] = try await api.get("/api/quotes", query: ["symbols": symbol])
                guard accept() else { return }; quote = values.first
            case .chart:
                let values: [Candle] = try await api.get("/api/history/\(symbol)", query: ["range": selectedRange])
                guard accept() else { return }; candles = values.sorted { $0.time < $1.time }; loadedRange = selectedRange
            case .news:
                let values: [NewsItem] = try await api.get("/api/news", query: ["symbol": symbol])
                guard accept() else { return }; news = values
            case .notes: break // Notes use their own cursor and search request guard.
            }
            updated[section] = .now
        } catch {
            guard accept(), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await terminal.report(error) }
            else { errors[section] = error.localizedDescription }
        }
    }
    func searchNotes() async {
        let query = noteSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.utf16.count <= 200, query.split(whereSeparator: { $0.isWhitespace }).count <= 8 else {
            noteSearchError = nativeText("Use up to 200 characters and eight search keywords."); return
        }
        guard current else { return }
        noteSearchError = nil
        if query != notesQuery { notes = []; nextNoteCursor = nil; updated[.notes] = nil }
        notesQuery = query
        await loadNotes()
    }
    func clearNotesSearch() async { noteSearch = ""; await searchNotes() }
    func loadMoreNotes() async {
        guard let cursor = nextNoteCursor, !loading.contains(.notes), !loadingMoreNotes else { return }
        await loadNotes(before: cursor)
    }
    private func loadNotes(before: Int? = nil) async {
        guard current, let api = terminal.api else { return }
        let request = UUID(), query = notesQuery
        requests[.notes] = request
        if before == nil { loading.insert(.notes); errors[.notes] = nil; loadingMoreNotes = false }
        else { loadingMoreNotes = true }
        notePageError = nil
        defer {
            if requests[.notes] == request { loading.remove(.notes); loadingMoreNotes = false }
        }
        func accept() -> Bool { current && !Task.isCancelled && requests[.notes] == request && notesQuery == query }
        var parameters = ["symbol": symbol, "kind": "research"]
        if !query.isEmpty { parameters["q"] = query }
        if let before { parameters["before"] = String(before) }
        do {
            let page: JournalList = try await api.get("/api/journal", query: parameters)
            guard accept() else { return }
            guard query.isEmpty || page.query == query else {
                throw ConnectionError.response(409, "Update the Mac backend to search research notes.")
            }
            var seen = Set(before == nil ? [] : notes.map(\.id))
            let rows = page.entries.filter { seen.insert($0.id).inserted }
            notes = before == nil ? rows : notes + rows
            nextNoteCursor = page.nextCursor.flatMap { $0 > 0 && $0 < (before ?? Int.max) ? $0 : nil }
            updated[.notes] = .now
        } catch {
            guard accept(), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await terminal.report(error) }
            else if before == nil { errors[.notes] = error.localizedDescription }
            else { notePageError = error.localizedDescription }
        }
    }
    private var loadedRange: String?
    func saveNote() async {
        guard current, let api = terminal.api, !saving else { return }
        let submitted = draft
        guard !submitted.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, submitted.title.utf16.count <= 120, submitted.body.utf16.count <= 20000 else {
            saveError = nativeText("Use a title up to 120 characters and a note up to 20,000 characters."); return
        }
        saving = true; message = nil; saveError = nil; defer { saving = false }
        do {
            let _: Acknowledgement = try await api.post("/api/journal", body: NoteInput(symbol: symbol, title: submitted.title.trimmingCharacters(in: .whitespacesAndNewlines), body: submitted.body))
            guard current, !Task.isCancelled else { return }
            if draft == submitted && terminal.researchDrafts[draftKey] == submitted {
                title = ""; bodyText = ""; message = nativeText("Note saved.")
            } else { message = nativeText("Note saved. Newer edits are kept as a draft.") }
            noteState.savedRevision += 1
            await load(.notes)
        } catch {
            guard current, !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { await terminal.report(error) }
            else { saveError = error.localizedDescription }
        }
    }
}
func nativeText(_ key: String) -> String { NSLocalizedString(key, comment: "") }
