import Foundation
import Testing
@testable import OpenTerminalCore

struct AlertEditTests {
    @Test func editableThresholdsRoundTripWithoutGroupingRoundingOrScientificNotation() throws {
        for identifier in ["en_US", "de_DE", "fr_FR", "ar_EG"] {
            let locale = Locale(identifier: identifier)
            for value in [Double.leastNonzeroMagnitude, 1e-20, 0.00000001, 0.12345678901234568, 123.45678901234567, 999999999999999.9, 1e15] {
                for type in [AlertTrigger.priceAbove, .volumeBelow] {
                    let text = try #require(type.thresholdText(value, locale: locale))
                    #expect(!text.lowercased().contains("e") && type.parseThreshold(text, locale: locale) == value)
                }
            }
            for value in [-100.0, -3.5000000000000004, -1e-20, 0] {
                let text = try #require(AlertTrigger.dailyFall.thresholdText(value, locale: locale))
                #expect(AlertTrigger.dailyFall.parseThreshold(text, locale: locale) == value)
            }
        }
    }
    @Test func invalidThresholdsCannotBecomeEditableDefaults() {
        for value in [Double.nan, .infinity, -.infinity, -1, 0, 1e16] { #expect(AlertTrigger.priceAbove.thresholdText(value) == nil) }
        #expect(AlertTrigger.dailyFall.thresholdText(3.5) == nil)
        #expect(AlertTrigger.dailyRise.thresholdText(-3.5) == nil)
        #expect(AlertTrigger.dailyRise.thresholdText(-0.0) == "0")
    }
    @Test func editPatchContainsOnlyReviewedEditableFields() throws {
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(AlertEdit(threshold: -3.5, label: "Changed"))) as? [String: Any]
        #expect(Set(encoded?.keys.map { $0 } ?? []) == Set(["threshold", "label"]))
        #expect(encoded?["threshold"] as? Double == -3.5 && encoded?["label"] as? String == "Changed")
    }
    @Test func acknowledgementKeepsRuleIdentityPolicyAndArmedState() throws {
        let rule = try JSONDecoder().decode(AlertRule.self, from: Data(#"{"id":1,"symbol":"AAPL","condition":"CHANGE_BELOW","metric":"native","threshold":-3.5,"label":"Before","armed":0,"revision":4,"generation":"g1","repeat_seconds":12345,"last_checked_at":"2026-10-28T01:00:00Z","last_value":-1,"last_triggered_at":"2026-10-27T12:00:00Z"}"#.utf8))
        let updated = rule.updating(AlertEdit(threshold: -5, label: "After"))
        #expect(updated.threshold == -5 && updated.label == "After" && updated.revision == 5)
        #expect(updated.id == rule.id && updated.symbol == rule.symbol && updated.condition == rule.condition && updated.metric == rule.metric)
        #expect(updated.repeat_seconds == 12345 && updated.armed == 0 && updated.generation == rule.generation)
        #expect(updated.last_checked_at == nil && updated.last_value == nil && updated.last_triggered_at == rule.last_triggered_at)
    }
}
