import Foundation
import SwiftUI
import OpenTerminalCore

struct AlertDraft: Equatable {
    var symbol = ""
    var threshold = ""
    var label = ""
    var condition = "PRICE_ABOVE"
    var metric = "native"
    var trigger: AlertTrigger? { AlertTrigger(metric: metric, condition: condition) }
    var isEmpty: Bool { symbol.isEmpty && threshold.isEmpty && label.isEmpty && condition == "PRICE_ABOVE" && metric == "native" }
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
