import Foundation

public enum PriceInput {
    /// Plain positive decimal prices only. Grouping and alternate separators are deliberately rejected.
    public static func parse(_ input: String, locale: Locale = .current) -> Double? {
        guard let value = PlainDecimalInput.magnitude(input, locale: locale, maximum: "1000000000000000"), value > 0 else { return nil }
        return value
    }

    public static func example(locale: Locale = .current) -> String { "200\(locale.decimalSeparator ?? ".")5" }
}

enum PlainDecimalInput {
    /// Unsigned decimal magnitude, including an explicit zero. The bound is a positive integer.
    static func magnitude(_ input: String, locale: Locale, maximum: String) -> Double? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = text.components(separatedBy: locale.decimalSeparator ?? ".")
        guard parts.count <= 2 else { return nil }
        var normalized: [String] = []
        for part in parts {
            var digits = ""
            for scalar in part.unicodeScalars {
                guard CharacterSet.decimalDigits.contains(scalar), let digit = Character(String(scalar)).wholeNumberValue,
                      (0...9).contains(digit) else { return nil }
                digits += String(digit)
            }
            normalized.append(digits)
        }
        guard normalized.contains(where: { !$0.isEmpty }) else { return nil }
        // Check the textual bound before Double rounds a just-over-limit fraction down to the limit.
        let integer = normalized[0].drop(while: { $0 == "0" })
        guard integer.count < maximum.count || (integer.count == maximum.count && integer <= maximum) else { return nil }
        if integer == maximum, normalized.count == 2, normalized[1].contains(where: { $0 != "0" }) { return nil }
        guard let value = Double(normalized.joined(separator: ".")), value.isFinite else { return nil }
        // A nonzero decimal that underflows must not become an accepted zero-percent threshold.
        if value == 0, normalized.contains(where: { $0.contains(where: { $0 != "0" }) }) { return nil }
        return value
    }
}
