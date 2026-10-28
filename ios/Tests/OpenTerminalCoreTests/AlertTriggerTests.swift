import Foundation
import Testing
@testable import OpenTerminalCore

struct AlertTriggerTests {
    @Test func sixTypesEncodeTheBackendMetricAndConditionWithoutChangingUnits() throws {
        let cases: [(AlertTrigger, String, String, String)] = [
            (.priceAbove, "native", "PRICE_ABOVE", "Price ≥"), (.priceBelow, "native", "PRICE_BELOW", "Price ≤"),
            (.dailyRise, "native", "CHANGE_ABOVE", "Day change ≥"), (.dailyFall, "native", "CHANGE_BELOW", "Day change ≤"),
            (.volumeAbove, "volume", "PRICE_ABOVE", "Volume ≥"), (.volumeBelow, "volume", "PRICE_BELOW", "Volume ≤")
        ]
        #expect(AlertTrigger.allCases.count == cases.count)
        for (type, metric, condition, label) in cases {
            let body = try JSONEncoder().encode(AlertInput(symbol: "AAPL", trigger: type, threshold: 3.5, label: "Phone rule"))
            let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
            #expect(object["metric"] as? String == metric && object["condition"] as? String == condition)
            #expect(object["threshold"] as? Double == 3.5 && object["armed"] as? Bool == true)
            #expect(type.labelKey == label && AlertTrigger(metric: metric, condition: condition) == type)
        }
        #expect(AlertTrigger(metric: "volume", condition: "CHANGE_ABOVE") == nil)
        #expect(AlertTrigger(metric: "future", condition: "PRICE_ABOVE") == nil)
        #expect(AlertTrigger(metric: "native", condition: "UNKNOWN") == nil)
    }
    @Test func percentageInputUsesLocaleDigitsAndKeepsTheDailyFallSign() {
        let cases: [(AlertTrigger, String, String, Double)] = [
            (.dailyRise, "en_US", " 3.5 ", 3.5), (.dailyFall, "en_US", " -3.5 ", -3.5),
            (.dailyRise, "fr_FR", "3,5", 3.5), (.dailyFall, "de_DE", "−3,5", -3.5),
            (.dailyRise, "ar_EG", "٣٫٥", 3.5), (.dailyFall, "ar_EG", "-٣٫٥", -3.5),
            (.dailyRise, "fa_IR", "۳٫۵", 3.5), (.dailyFall, "fa_IR", "−۳٫۵", -3.5),
            (.dailyFall, "hi_IN", "-३.५", -3.5), (.volumeAbove, "de_DE", "100000,5", 100000.5),
            (.dailyRise, "en_US", ".5", 0.5), (.dailyFall, "en_US", "-.5", -0.5)
        ]
        for (type, language, input, expected) in cases { #expect(type.parseThreshold(input, locale: Locale(identifier: language)) == expected) }
    }
    @Test func signedAndZeroThresholdsFollowTheBackendBoundsBeforeDoubleRounding() {
        let locale = Locale(identifier: "en_US")
        for input in ["0", "0.0", "000.000"] {
            #expect(AlertTrigger.dailyRise.parseThreshold(input, locale: locale) == 0)
            #expect(AlertTrigger.dailyFall.parseThreshold(input, locale: locale) == 0)
            #expect(AlertTrigger.volumeAbove.parseThreshold(input, locale: locale) == nil)
        }
        #expect(AlertTrigger.dailyRise.parseThreshold("1000000.00", locale: locale) == 1e6)
        #expect(AlertTrigger.dailyRise.parseThreshold("1000000.00000000001", locale: locale) == nil)
        #expect(AlertTrigger.dailyFall.parseThreshold("-100.00", locale: locale) == -100)
        #expect(AlertTrigger.dailyFall.parseThreshold("-100.00000000000001", locale: locale) == nil)
        #expect(AlertTrigger.dailyRise.parseThreshold("-0.1", locale: locale) == nil)
        #expect(AlertTrigger.dailyFall.parseThreshold("0.1", locale: locale) == nil)
        let tiny = "0." + String(repeating: "0", count: 400) + "1"
        #expect(AlertTrigger.dailyRise.parseThreshold(tiny, locale: locale) == nil)
        #expect(AlertTrigger.dailyFall.parseThreshold("-" + tiny, locale: locale) == nil)
        #expect(AlertTrigger.dailyRise.parseThreshold("0.00000001", locale: locale) == 1e-8)
        #expect(AlertTrigger.volumeBelow.parseThreshold("1000000000000000.01", locale: locale) == nil)
    }
    @Test func percentageAndVolumeInputsRejectGroupingUnitsAndPartialNumbers() {
        for type in [AlertTrigger.dailyRise, .dailyFall, .volumeAbove, .volumeBelow] {
            for input in ["", "3.5%", "1e2", "NaN", "Infinity", "+3.5", "1 000", "3.5 USD", "1,000", "3.5text", "--3.5", "- 3.5", "0\u{200b}0"] {
                #expect(type.parseThreshold(input, locale: Locale(identifier: "en_US")) == nil)
            }
            #expect(type.parseThreshold("3.5", locale: Locale(identifier: "de_DE")) == nil)
            #expect(type.parseThreshold("1.234,5", locale: Locale(identifier: "de_DE")) == nil)
        }
    }
    @Test func everyDisplayedExampleIsAcceptedIncludingNegativeKeyboardInput() {
        for identifier in ["en_US", "zh_CN", "de_DE", "fr_FR", "ar_EG", "fa_IR"] {
            let locale = Locale(identifier: identifier)
            for type in AlertTrigger.allCases {
                #expect(type.parseThreshold(type.example(locale: locale), locale: locale) != nil)
                #expect(type.allowsNegativeInput == (type == .dailyFall))
            }
        }
    }
}
