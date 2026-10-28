import Foundation
import SwiftUI
import Combine
import OpenTerminalCore

@MainActor final class AlertHistoryModel: ObservableObject {
    @Published private(set) var events: [AlertEvent] = []
    @Published private(set) var nextCursor: Int?
    @Published private(set) var loadingLatest = false
    @Published private(set) var loadingMore = false
    @Published private(set) var error: String?
    @Published private(set) var pageError: String?
    @Published private(set) var updated: Date?
    @Published private(set) var hasLoaded = false
    private let terminal: TerminalModel
    private let session: UUID
    private var requestID: UUID?
    private var authorization: AnyCancellable?

    init(terminal: TerminalModel) {
        self.terminal = terminal; session = terminal.sessionID
        authorization = terminal.$signedIn.sink { [weak self] signedIn in if !signedIn { self?.clear() } }
    }
    private var current: Bool { terminal.signedIn && terminal.sessionID == session }
    private func clear() {
        requestID = nil; events = []; nextCursor = nil; loadingLatest = false; loadingMore = false
        error = nil; pageError = nil; updated = nil; hasLoaded = false
    }
    func loadLatest() async { await load() }
    func loadMore() async {
        guard let cursor = nextCursor, !loadingLatest, !loadingMore else { return }
        await load(before: cursor)
    }
    private func load(before: Int? = nil) async {
        guard current, !Task.isCancelled, let api = terminal.api else { return }
        let request = UUID(); requestID = request
        if before == nil { loadingLatest = true; loadingMore = false; error = nil }
        else { loadingMore = true }
        pageError = nil
        defer { if requestID == request { loadingLatest = false; loadingMore = false } }
        func accepts() -> Bool { current && requestID == request && !Task.isCancelled }
        do {
            let page: AlertHistoryPage = try await api.get("/api/alerts/history", query: before.map { ["before": String($0)] } ?? [:])
            guard accepts() else { return }
            var seen = Set(before == nil ? [] : events.map(\.id))
            let rows = page.events.filter { seen.insert($0.id).inserted }
            events = before == nil ? rows : events + rows
            nextCursor = page.nextCursor.flatMap { $0 > 0 && $0 < (before ?? Int.max) ? $0 : nil }
            updated = .now; hasLoaded = true
        } catch {
            guard accepts(), !(error is CancellationError) else { return }
            if error as? ConnectionError == .unauthorized { clear(); await terminal.report(error) }
            else if before == nil { self.error = error.localizedDescription }
            else { pageError = error.localizedDescription }
        }
    }
}

func alertValueText(_ value: Double, kind: AlertValueKind, currency: String? = nil, locale: Locale = .current) -> String {
    let text = value.formatted(.number.precision(.significantDigits(1...15)).locale(locale))
    if kind == .dailyChange { return text + "%" }
    if kind == .price, let currency, !currency.isEmpty { return text + " " + currency }
    return text
}
