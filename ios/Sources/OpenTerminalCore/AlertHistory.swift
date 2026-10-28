import Foundation

public enum AlertValueKind: Sendable { case price, dailyChange, volume, unknown }

func alertValueKind(metric: String?, condition: String) -> AlertValueKind {
    let price = ["PRICE_ABOVE", "PRICE_BELOW"].contains(condition)
    if metric == "volume" { return price ? .volume : .unknown }
    guard metric == nil || metric == "native" else { return .unknown }
    if price { return .price }
    return ["CHANGE_ABOVE", "CHANGE_BELOW"].contains(condition) ? .dailyChange : .unknown
}
func alertConditionLabel(metric: String?, condition: String) -> String {
    switch (alertValueKind(metric: metric, condition: condition), condition) {
    case (.price, "PRICE_ABOVE"): "Price ≥"
    case (.price, "PRICE_BELOW"): "Price ≤"
    case (.volume, "PRICE_ABOVE"): "Volume ≥"
    case (.volume, "PRICE_BELOW"): "Volume ≤"
    case (.dailyChange, "CHANGE_ABOVE"): "Day change ≥"
    case (.dailyChange, "CHANGE_BELOW"): "Day change ≤"
    default: condition
    }
}

public struct AlertEvent: Decodable, Identifiable, Equatable, Sendable {
    public let id: Int
    public let alert_id: Int?
    public let symbol: String
    public let condition: String
    public let threshold: Double
    public let label: String
    public let value: Double
    public let price: Double
    public let currency: String?
    public let source: String
    public let observed_at: String?
    public let created_at: String
    public let metric: String?
    public var valueKind: AlertValueKind { alertValueKind(metric: metric, condition: condition) }
    public var conditionLabelKey: String { alertConditionLabel(metric: metric, condition: condition) }
    public var recordedAt: Date? { Quote.timestamp(created_at) }
    public var observedAt: Date? { observed_at.flatMap(Quote.timestamp) }
}
public struct AlertHistoryPage: Decodable, Sendable { public let events: [AlertEvent]; public let nextCursor: Int? }
