import Foundation

/// Simple creation presets within the Mac's supported cooldown range.
public enum AlertRepeatPolicy: Int, CaseIterable, Sendable {
    case once = 0, oneMinute = 60, fiveMinutes = 300, fifteenMinutes = 900, oneHour = 3600, oneDay = 86400

    public var labelKey: String {
        switch self {
        case .once: "Once"
        case .oneMinute: "1 minute"
        case .fiveMinutes: "5 minutes"
        case .fifteenMinutes: "15 minutes"
        case .oneHour: "1 hour"
        case .oneDay: "1 day"
        }
    }
}

public enum AlertRepeatBehavior: Equatable, Sendable {
    case once, cooldown(Int), unavailable
}

extension AlertRule {
    public var repeatBehavior: AlertRepeatBehavior {
        guard let repeat_seconds else { return .unavailable }
        if repeat_seconds == 0 { return .once }
        guard (60...86400).contains(repeat_seconds) else { return .unavailable }
        return .cooldown(repeat_seconds)
    }
}
