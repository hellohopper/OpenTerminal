import Foundation

public struct Quote: Decodable, Identifiable, Sendable {
    public var id: String { symbol }
    public let symbol: String
    public let name: String?
    public let price: Double?
    public let changePercent: Double?
    public let currency: String?
    public let source: String
    public let retrievedAt: String?
    public let stale: Bool?
    public func isUsableUSD(at now: Date = .now) -> Bool {
        guard let price, price.isFinite, price > 0, currency == "USD", stale != true,
              let retrievedAt, let date = Self.timestamp(retrievedAt) else { return false }
        return now.timeIntervalSince(date) <= 120 && date.timeIntervalSince(now) <= 300
    }
    public static func timestamp(_ value: String) -> Date? {
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return format.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
public struct Portfolio: Decodable, Identifiable, Sendable { public let id: Int; public let name: String }
public struct Position: Decodable, Identifiable, Sendable {
    public var id: String { symbol }
    public let symbol: String
    public let quantity: Double
    public let avgCost: Double
    public let realizedPnl: Double
}
public struct HoldingValuation: Sendable {
    public let marketValue: Double?
    public let unrealized: Double?
    public let missingSymbols: [String]
    public init(positions: [Position], quotes: [Quote], now: Date = .now) {
        var value = 0.0, pnl = 0.0, missing: [String] = []
        for position in positions where position.quantity != 0 {
            guard let quote = quotes.first(where: { $0.symbol == position.symbol }), quote.isUsableUSD(at: now), let price = quote.price else { missing.append(position.symbol); continue }
            value += price * position.quantity; pnl += (price - position.avgCost) * position.quantity
        }
        missingSymbols = missing; marketValue = missing.isEmpty ? value : nil; unrealized = missing.isEmpty ? pnl : nil
    }
}
public struct AlertRule: Decodable, Identifiable, Equatable, Sendable {
    public let id: Int; public let symbol: String; public let condition: String
    public let threshold: Double; public let label: String; public let armed: Int
    public let revision: Int?; public let generation: String?
    public let metric: String?
    public var valueKind: AlertValueKind { alertValueKind(metric: metric, condition: condition) }
    public var conditionLabelKey: String { alertConditionLabel(metric: metric, condition: condition) }
    public var mutationQuery: [String: String]? {
        guard let revision, revision >= 0, revision < 9_007_199_254_740_991,
              let generation, !generation.isEmpty, generation.utf16.count <= 100 else { return nil }
        return ["revision": String(revision), "generation": generation]
    }
    public func settingArmed(_ value: Bool) -> Self {
        Self(id: id, symbol: symbol, condition: condition, threshold: threshold, label: label, armed: value ? 1 : 0,
             revision: revision.flatMap { $0 < 9_007_199_254_740_991 ? $0 + 1 : nil }, generation: generation, metric: metric)
    }
}
public struct AlertList: Decodable, Sendable { public let alerts: [AlertRule] }
public struct AlertInput: Encodable, Sendable {
    public let symbol: String; public let condition: String; public let threshold: Double; public let label: String; public let armed: Bool
    public init(symbol: String, condition: String, threshold: Double, label: String) {
        self.symbol = symbol; self.condition = condition; self.threshold = threshold; self.label = label; armed = true
    }
}
public struct NewsItem: Decodable, Identifiable, Sendable {
    public var id: String { link }; public let title: String; public let link: String; public let publisher: String
    public var url: URL? { guard let url = URL(string: link), ["https", "http"].contains(url.scheme) else { return nil }; return url }
}
public struct Briefing: Decodable, Sendable {
    public let date: String; public let summary: String; public let indexes: [Quote]; public let headlines: [NewsItem]; public let warnings: [String]
}
public struct Candle: Decodable, Identifiable, Sendable { public var id: Double { time }; public let time: Double; public let close: Double; public var date: Date { Date(timeIntervalSince1970: time) } }
public struct JournalEntry: Decodable, Identifiable, Equatable, Sendable { public let id: Int; public let symbol: String; public let title: String; public let body: String; public let version: String? }
public struct JournalList: Decodable, Sendable { public let entries: [JournalEntry]; public let nextCursor: Int?; public let query: String? }
public struct NoteInput: Encodable, Sendable {
    public let symbol: String; public let title: String; public let body: String; public let kind = "research"
    public init(symbol: String, title: String, body: String) { self.symbol = symbol; self.title = title; self.body = body }
}
public struct SharedWorkspace: Decodable, Identifiable, Equatable, Sendable { public let id: String; public let name: String; public let watchlist: [String] }
public struct SyncSnapshot: Decodable, Sendable {
    public struct Payload: Decodable, Sendable {
        public struct Workspaces: Decodable, Sendable { public let workspaces: [SharedWorkspace] }
        public let workspace: Workspaces
    }
    public let payload: Payload
}
public struct MobileCredential: Codable, Sendable {
    public let id: String; public let name: String; public let token: String; public let expiresAt: String
    public init(id: String, name: String, token: String, expiresAt: String) { self.id=id; self.name=name; self.token=token; self.expiresAt=expiresAt }
}
public struct MobileAuthorization: Decodable, Sendable { public let id: String; public let name: String; public let expiresAt: String }
public struct SharedWatchlist: Decodable, Identifiable, Equatable, Sendable {
    public struct Payload: Decodable, Equatable, Sendable { public let name: String; public let symbols: [String] }
    public let id: Int; public let version: Int; public let payload: Payload
    public func replacingSymbols(_ symbols: [String], version: Int) -> Self {
        Self(id: id, version: version, payload: Payload(name: payload.name, symbols: symbols))
    }
}
public struct MobileDeviceInfo: Decodable, Identifiable, Equatable, Sendable {
    public let id: String; public let name: String; public let expires_at: String; public let revoked_at: String?
    public func markingRevoked(at date: String) -> Self { Self(id: id, name: name, expires_at: expires_at, revoked_at: revoked_at ?? date) }
}
public struct NativePushStatus: Decodable, Sendable { public let configured: Bool; public let environment: String?; public let topic: String? }
public func normalizedSymbol(_ value: String) -> String? {
    let symbol = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    return symbol.range(of: "^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$", options: .regularExpression) != nil ? symbol : nil
}
