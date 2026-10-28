import Foundation
import SwiftUI
import OpenTerminalCore

struct AlertDraft: Equatable {
    var symbol = ""
    var threshold = ""
    var label = ""
    var condition = "PRICE_ABOVE"
    var metric = "native"
    var repeatPolicy: AlertRepeatPolicy = .once
    var trigger: AlertTrigger? { AlertTrigger(metric: metric, condition: condition) }
    var isEmpty: Bool { symbol.isEmpty && threshold.isEmpty && label.isEmpty && condition == "PRICE_ABOVE" && metric == "native" && repeatPolicy == .once }
}

func alertRepeatText(_ rule: AlertRule, locale: Locale = .current) -> String {
    switch rule.repeatBehavior {
    case .once: nativeText("One-shot alert")
    case .cooldown(let seconds): nativeText("Repeat cooldown: %@ seconds").replacingOccurrences(of: "%@", with: seconds.formatted(.number.locale(locale)))
    case .unavailable: nativeText("Repeat policy unavailable.")
    }
}

@MainActor final class AlertEditorState: ObservableObject {
    @Published var draft = AlertDraft() {
        didSet {
            guard draft != oldValue else { return }
            revision += 1; error = nil; message = nil
        }
    }
    @Published var saving = false
    @Published var error: String?
    @Published var message: String?
    @Published var savedRevision = 0
    private(set) var revision = 0
    var hasDraft: Bool { !draft.isEmpty }
    func selectTrigger(_ trigger: AlertTrigger) {
        guard draft.trigger != trigger else { return }
        var next = draft; next.condition = trigger.condition; next.metric = trigger.metric; next.threshold = ""
        draft = next
    }
    func discard() { guard !saving else { return }; clear() }
    func clear() { draft = AlertDraft(); saving = false; error = nil; message = nil }
}

@MainActor final class AlertEditState: ObservableObject, Identifiable {
    let id = UUID()
    let ruleID: Int
    let session: UUID
    let locale: Locale
    @Published private(set) var original: AlertRule?
    @Published var threshold: String { didSet { if threshold != oldValue { changed() } } }
    @Published var label: String { didSet { if label != oldValue { changed() } } }
    @Published var saving = false
    @Published var reloading = false
    @Published var needsReview = false
    @Published var error: String?
    @Published var message: String?
    @Published var savedRevision = 0
    private(set) var revision = 0
    private var baselineThreshold: String
    private var baselineLabel: String
    private var keptEdits = false
    var hasDraft: Bool { keptEdits || threshold != baselineThreshold || label != baselineLabel }

    init(rule: AlertRule, text: String, session: UUID, locale: Locale) {
        ruleID = rule.id; original = rule; self.session = session; self.locale = locale
        threshold = text; label = rule.label; baselineThreshold = text; baselineLabel = rule.label
    }
    private func changed() { revision += 1; if !needsReview { error = nil }; message = nil }
    func discard() {
        guard !saving, !reloading else { return }
        threshold = baselineThreshold; label = baselineLabel; keptEdits = false; error = nil; message = nil
    }
    func reload(_ rule: AlertRule, text: String) {
        original = rule; baselineThreshold = text; baselineLabel = rule.label
        threshold = text; label = rule.label; keptEdits = false; needsReview = false; error = nil; message = nil
    }
    func acknowledge(_ rule: AlertRule, text: String, label: String, submittedRevision: Int) {
        original = rule; baselineThreshold = text; baselineLabel = label; keptEdits = revision != submittedRevision
        message = nativeText(keptEdits ? "Alert updated. Newer edits are kept as a draft." : "Alert updated.")
        savedRevision += 1
    }
    func clear() {
        original = nil; baselineThreshold = ""; baselineLabel = ""; threshold = ""; label = ""
        keptEdits = false; saving = false; reloading = false; needsReview = false; error = nil; message = nil
    }
}
