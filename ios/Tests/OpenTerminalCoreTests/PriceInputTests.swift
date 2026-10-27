import Foundation
import Testing
@testable import OpenTerminalCore

struct PriceInputTests {
    @Test func parsesTheLocalesDecimalSeparatorAndUnicodeDecimalDigits() {
        let cases: [(String, String, Double)] = [
            ("en_US", "200.5", 200.5), ("zh_CN", " 200.5\n", 200.5),
            ("fr_FR", "200,5", 200.5), ("de_DE", "200,5", 200.5),
            ("ar_EG", "٢٠٠٫٥", 200.5), ("fa_IR", "۲۰۰٫۵", 200.5),
            ("hi_IN", "२००.५", 200.5), ("bn_BD", "২০০.৫", 200.5),
            ("zh_CN", "２００.５", 200.5), ("en_US", ".5", 0.5),
            ("fr_FR", ",5", 0.5), ("de_DE", "200,", 200),
            ("en_US", "200.", 200), ("en_US", "000200.500", 200.5),
        ]
        for (identifier, input, expected) in cases {
            #expect(PriceInput.parse(input, locale: Locale(identifier: identifier)) == expected)
        }
    }

    @Test func rejectsGroupingAlternateSeparatorsAndPartiallyNumericText() {
        let cases: [(String, String)] = [
            ("en_US", "1,234.5"), ("en_US", "1,234"), ("en_US", "200,5"),
            ("de_DE", "1.234,5"), ("de_DE", "1.234"), ("de_DE", "200.5"),
            ("fr_FR", "1\u{202f}234,5"), ("fr_FR", "1\u{a0}234,5"),
            ("ar_EG", "١٬٢٣٤٫٥"), ("ar_EG", "٢٠٠.٥"),
            ("en_US", "1.2.3"), ("en_US", "."), ("fr_FR", ","),
            ("en_US", ""), ("en_US", " \n "), ("en_US", "+200.5"),
            ("en_US", "-200.5"), ("en_US", "$200.5"), ("en_US", "200.5 USD"),
            ("en_US", "200.5%"), ("en_US", "2e2"), ("en_US", "NaN"),
            ("en_US", "Infinity"), ("en_US", "200 5"), ("en_US", "Ⅻ"),
            ("en_US", "²"), ("en_US", "⑧"), ("en_US", "二十"), ("en_US", "200\u{200b}.5"),
        ]
        for (identifier, input) in cases { #expect(PriceInput.parse(input, locale: Locale(identifier: identifier)) == nil) }
    }

    @Test func enforcesPositivePricesAndTheBackendBoundBeforeRounding() {
        let locale = Locale(identifier: "en_US")
        for input in ["0", "0.0", "000.000", "1000000000000001", "1000000000000000.01", String(repeating: "9", count: 400), "0." + String(repeating: "0", count: 400) + "1"] {
            #expect(PriceInput.parse(input, locale: locale) == nil)
        }
        #expect(PriceInput.parse("1000000000000000.00", locale: locale) == 1e15)
        #expect(PriceInput.parse("0001000000000000000", locale: locale) == 1e15)
        #expect(PriceInput.parse("0.00000001", locale: locale) == 0.00000001)
        #expect(PriceInput.parse(String(repeating: "0", count: 400) + "1", locale: locale) == 1)
        #expect(PriceInput.parse("1000000000000000,01", locale: Locale(identifier: "de_DE")) == nil)
    }

    @Test func displayedExamplesAreAcceptedByTheSameParser() {
        for identifier in ["en_US", "zh_CN", "de_DE", "fr_FR", "ar_EG", "fa_IR", "hi_IN"] {
            let locale = Locale(identifier: identifier)
            #expect(PriceInput.parse(PriceInput.example(locale: locale), locale: locale) == 200.5)
        }
    }
}
