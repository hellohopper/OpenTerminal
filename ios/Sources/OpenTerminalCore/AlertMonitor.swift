import Foundation

public struct AlertMonitor: Decodable, Equatable, Sendable {
    public let running: Bool?
    public let checking: Bool?
    public let intervalMs: Double?
    public let lastCheckedAt: String?
    public let lastError: String?
    public let missingSymbols: [String]?

    public enum State: Sendable { case running, checking, stopped, stopping, unavailable }
    public var state: State {
        if running == false { return checking == true ? .stopping : .stopped }
        if running == true { return checking == true ? .checking : .running }
        return .unavailable
    }
    public var stateLabelKey: String {
        switch state {
        case .running: "Running"
        case .checking: "Checking"
        case .stopped: "Stopped"
        case .stopping: "Stopping"
        case .unavailable: "Unavailable"
        }
    }
    public var lastAttempt: Date? { lastCheckedAt.flatMap(Quote.timestamp) }
    public var intervalSeconds: Double? {
        guard let intervalMs, intervalMs.isFinite, intervalMs > 0 else { return nil }
        return intervalMs / 1000
    }
}

extension AlertRule {
    public var lastEvaluation: Date? { last_checked_at.flatMap(Quote.timestamp) }
    public var lastTrigger: Date? { last_triggered_at.flatMap(Quote.timestamp) }
    /// Successful checks can update observational fields without changing the rule revision.
    /// An ordinary monitor tick must not invalidate a reviewed pause or deletion.
    public func matchesDefinition(_ other: Self) -> Bool {
        id == other.id && symbol == other.symbol && condition == other.condition && threshold == other.threshold
            && label == other.label && armed == other.armed && revision == other.revision && generation == other.generation && metric == other.metric && repeat_seconds == other.repeat_seconds
    }
}
