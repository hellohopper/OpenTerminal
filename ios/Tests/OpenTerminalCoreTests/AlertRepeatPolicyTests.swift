import Foundation
import Testing
@testable import OpenTerminalCore

struct AlertRepeatPolicyTests {
    private func rule(seconds: Int?, lastValue: Double = 110) throws -> AlertRule {
        var data: [String: Any] = ["id": 1, "symbol": "AAPL", "condition": "PRICE_ABOVE", "threshold": 200, "label": "Target", "armed": 1, "revision": 3, "generation": "g1", "metric": "native",
                                 "last_checked_at": "2026-10-28T01:00:00Z", "last_value": lastValue, "last_triggered_at": "2026-10-27T12:00:00Z"]
        data["repeat_seconds"] = seconds
        return try JSONDecoder().decode(AlertRule.self, from: JSONSerialization.data(withJSONObject: data))
    }
    @Test func creationPresetsEncodeSecondsForAllSixAlertTypes() throws {
        #expect(AlertRepeatPolicy.allCases.map(\.rawValue) == [0, 60, 300, 900, 3600, 86400])
        for policy in AlertRepeatPolicy.allCases {
            for trigger in AlertTrigger.allCases {
                let value = trigger == .dailyFall ? -3.5 : 3.5
                let input = AlertInput(symbol: "AAPL", trigger: trigger, threshold: value, label: "Phone", repeatPolicy: policy)
                let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
                #expect(encoded?["repeat_seconds"] as? Int == policy.rawValue && encoded?["armed"] as? Bool == true)
                #expect(encoded?["metric"] as? String == trigger.metric && encoded?["condition"] as? String == trigger.condition && encoded?["threshold"] as? Double == value)
            }
        }
    }
    @Test func bothExistingInitializersKeepTheirOneShotDefault() throws {
        let inputs = [AlertInput(symbol: "AAPL", condition: "PRICE_ABOVE", threshold: 200, label: "Old call"), AlertInput(symbol: "AAPL", trigger: .volumeAbove, threshold: 100000, label: "Typed call")]
        for input in inputs {
            let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
            #expect(encoded?["repeat_seconds"] as? Int == 0)
        }
    }
    @Test func rulesCanReportCustomWebCooldownsAsWellAsCreationPresets() throws {
        let once = try rule(seconds: 0); #expect(once.repeatBehavior == .once)
        for seconds in [60, 61, 300, 12345, 86400] {
            let value = try rule(seconds: seconds)
            #expect(value.repeatBehavior == .cooldown(seconds))
        }
        for seconds: Int? in [nil, -1, 1, 59, 86401] {
            let value = try rule(seconds: seconds); #expect(value.repeatBehavior == .unavailable)
        }
    }
    @Test func pauseAndRearmKeepTheRepeatPolicyAndLastTriggerTime() throws {
        for seconds in [0, 60, 61, 86400] {
            let original = try rule(seconds: seconds), paused = original.settingArmed(false), rearmed = paused.settingArmed(true)
            #expect(paused.repeat_seconds == seconds && rearmed.repeat_seconds == seconds)
            #expect(paused.last_triggered_at == original.last_triggered_at && rearmed.last_triggered_at == original.last_triggered_at)
            #expect(rearmed.armed == 1 && rearmed.revision == 5 && rearmed.last_checked_at == nil && rearmed.last_value == nil)
        }
    }
    @Test func reviewedDefinitionsIncludeTheRepeatPolicyWithoutIncludingMonitorValues() throws {
        let reviewed = try rule(seconds: 60), changed = try rule(seconds: 300), checked = try rule(seconds: 60, lastValue: 120)
        #expect(!reviewed.matchesDefinition(changed) && reviewed.matchesDefinition(checked))
        let unknown = try rule(seconds: nil)
        #expect(!unknown.matchesDefinition(reviewed))
    }
}
