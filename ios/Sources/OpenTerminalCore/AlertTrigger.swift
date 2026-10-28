import Foundation

public enum AlertTrigger: String, CaseIterable, Sendable {
    case priceAbove, priceBelow, dailyRise, dailyFall, volumeAbove, volumeBelow

    public init?(metric: String, condition: String) {
        guard let value = Self.allCases.first(where: { $0.metric == metric && $0.condition == condition }) else { return nil }
        self = value
    }
    public var metric: String { self == .volumeAbove || self == .volumeBelow ? "volume" : "native" }
    public var condition: String {
        switch self {
        case .priceAbove, .volumeAbove: "PRICE_ABOVE"
        case .priceBelow, .volumeBelow: "PRICE_BELOW"
        case .dailyRise: "CHANGE_ABOVE"
        case .dailyFall: "CHANGE_BELOW"
        }
    }
    public var labelKey: String { alertConditionLabel(metric: metric, condition: condition) }
    public var allowsNegativeInput: Bool { self == .dailyFall }
    /// Editable decimal text must round-trip exactly, including values normally printed with an exponent.
    public func thresholdText(_ value: Double, locale: Locale = .current) -> String? {
        guard value.isFinite else { return nil }
        let source = value == 0 ? "0" : String(value)
        let parts = source.lowercased().split(separator: "e")
        var plain = source
        if parts.count == 2, let exponent = Int(parts[1]) {
            let negative = parts[0].hasPrefix("-")
            let magnitude = negative ? String(parts[0].dropFirst()) : String(parts[0])
            let digits = magnitude.replacingOccurrences(of: ".", with: "")
            let position = (magnitude.firstIndex(of: ".").map { magnitude.distance(from: magnitude.startIndex, to: $0) } ?? magnitude.count) + exponent
            if position <= 0 { plain = "0." + String(repeating: "0", count: -position) + digits }
            else if position >= digits.count { plain = digits + String(repeating: "0", count: position - digits.count) }
            else { let split = digits.index(digits.startIndex, offsetBy: position); plain = String(digits[..<split]) + "." + digits[split...] }
            if negative { plain = "-" + plain }
        }
        plain = plain.replacingOccurrences(of: ".", with: locale.decimalSeparator ?? ".")
        guard parseThreshold(plain, locale: locale) == value else { return nil }
        return plain
    }
    public var thresholdLabelKey: String {
        switch self {
        case .priceAbove, .priceBelow: "Price threshold"
        case .volumeAbove, .volumeBelow: "Volume threshold"
        case .dailyRise, .dailyFall: "Percentage threshold"
        }
    }
    public func parseThreshold(_ input: String, locale: Locale = .current) -> Double? {
        switch self {
        case .priceAbove, .priceBelow, .volumeAbove, .volumeBelow:
            return PriceInput.parse(input, locale: locale)
        case .dailyRise:
            return PlainDecimalInput.magnitude(input, locale: locale, maximum: "1000000")
        case .dailyFall:
            var magnitude = input.trimmingCharacters(in: .whitespacesAndNewlines)
            let negative = magnitude.hasPrefix("-") || magnitude.hasPrefix("−")
            if negative { magnitude.removeFirst() }
            // Keep the sign next to its digits; the unsigned parser trims outer whitespace.
            guard magnitude == magnitude.trimmingCharacters(in: .whitespacesAndNewlines),
                  let value = PlainDecimalInput.magnitude(magnitude, locale: locale, maximum: "100"), negative || value == 0 else { return nil }
            return negative ? -value : value
        }
    }
    public func example(locale: Locale = .current) -> String {
        switch self {
        case .priceAbove, .priceBelow: PriceInput.example(locale: locale)
        case .volumeAbove, .volumeBelow: "100000"
        case .dailyRise: "3\(locale.decimalSeparator ?? ".")5"
        case .dailyFall: "-3\(locale.decimalSeparator ?? ".")5"
        }
    }
    public var hintKey: String {
        switch self {
        case .priceAbove, .priceBelow: "Enter a price without thousands separators, for example %@."
        case .volumeAbove, .volumeBelow: "Enter a positive volume without thousands separators, for example %@."
        case .dailyRise: "Enter a daily rise percentage without %, for example %@."
        case .dailyFall: "Enter a daily fall percentage without %, for example %@."
        }
    }
    public var validationKey: String {
        switch self {
        case .priceAbove, .priceBelow: "Enter a valid positive price without thousands separators."
        case .volumeAbove, .volumeBelow: "Enter a valid positive volume without thousands separators."
        case .dailyRise: "Enter a percentage from 0 to 1000000 without a % sign."
        case .dailyFall: "Enter a percentage from -100 to 0 without a % sign."
        }
    }
}
