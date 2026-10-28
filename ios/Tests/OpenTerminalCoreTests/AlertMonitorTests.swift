import Foundation
import Testing
@testable import OpenTerminalCore

struct AlertMonitorTests {
    private func monitor(_ json: String) throws -> AlertMonitor { try JSONDecoder().decode(AlertMonitor.self, from: Data(json.utf8)) }
    private func rule(_ overrides: [String: Any] = [:]) throws -> AlertRule {
        var value: [String: Any] = ["id": 1, "symbol": "AAPL", "condition": "PRICE_ABOVE", "threshold": 200, "label": "Target", "armed": 1, "revision": 4, "generation": "g1", "metric": "native",
                                  "last_checked_at": "2026-10-28T01:00:00Z", "last_value": 110, "last_triggered_at": "2026-10-27T12:00:00Z"]
        value.merge(overrides) { _, new in new }
        return try JSONDecoder().decode(AlertRule.self, from: JSONSerialization.data(withJSONObject: value))
    }
    @Test func aFailedMonitorAttemptHasATimeWithoutClaimingSuccessfulRuleEvaluation() throws {
        let value = try monitor(#"{"running":true,"checking":false,"intervalMs":15000,"lastCheckedAt":"2026-10-28T01:00:00.500Z","lastError":"Fresh quotes unavailable for AAPL.","missingSymbols":["AAPL"],"nextCheckAt":"2026-10-28T01:00:15Z"}"#)
        #expect(value.state == .running && value.stateLabelKey == "Running" && value.intervalSeconds == 15)
        #expect(value.lastAttempt == Quote.timestamp("2026-10-28T01:00:00.500Z") && value.lastError != nil && value.missingSymbols == ["AAPL"])
        // The monitor attempt is independent of per-rule evaluation timestamps.
        let list = try JSONDecoder().decode(AlertList.self, from: Data(#"{"alerts":[{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":200,"label":"","armed":1}],"monitor":{"lastCheckedAt":"2026-10-28T01:00:00Z","lastError":"Provider unavailable"}}"#.utf8))
        #expect(list.monitor?.lastAttempt != nil && list.alerts.first?.lastEvaluation == nil)
    }
    @Test func legacyResponsesAndPartialMonitorDataStayUnavailable() throws {
        let legacy = try JSONDecoder().decode(AlertList.self, from: Data(#"{"alerts":[]}"#.utf8))
        #expect(legacy.monitor == nil)
        let partial = try monitor("{}")
        #expect(partial.state == .unavailable && partial.intervalSeconds == nil && partial.lastAttempt == nil && partial.missingSymbols == nil)
    }
    @Test(arguments: [
        (#"{"running":true,"checking":false}"#, AlertMonitor.State.running, "Running"),
        (#"{"running":true,"checking":true}"#, .checking, "Checking"),
        (#"{"running":false,"checking":false}"#, .stopped, "Stopped"),
        (#"{"running":false,"checking":true}"#, .stopping, "Stopping"),
        (#"{"running":null,"checking":true}"#, .unavailable, "Unavailable")
    ]) func schedulingAndInFlightWorkAreDistinguished(json: String, expected: AlertMonitor.State, label: String) throws {
        let value = try monitor(json)
        #expect(value.state == expected && value.stateLabelKey == label)
    }
    @Test func invalidIntervalsAndDatesCannotBecomeInventedCheckTimes() throws {
        for number in ["0", "-15000"] {
            let value = try monitor("{\"intervalMs\":\(number),\"lastCheckedAt\":\"invalid\"}")
            #expect(value.intervalSeconds == nil && value.lastAttempt == nil)
        }
        let value = try monitor(#"{"intervalMs":1500,"lastCheckedAt":"2026-10-28T01:00:00Z"}"#)
        #expect(value.intervalSeconds == 1.5 && value.lastAttempt != nil)
    }
    @Test func pauseAcknowledgementClearsEvaluationFieldsLikeTheBackendAndRetainsPastTrigger() throws {
        let original = try rule(), paused = original.settingArmed(false)
        #expect(original.last_value == 110 && original.lastEvaluation != nil && original.lastTrigger != nil)
        #expect(paused.last_checked_at == nil && paused.last_value == nil && paused.last_triggered_at == original.last_triggered_at)
        #expect(paused.armed == 0 && paused.revision == 5 && paused.metric == original.metric && paused.generation == original.generation)
    }
    @Test func monitorTicksDoNotChangeTheReviewedDefinitionButRealEditsDo() throws {
        let original = try rule()
        let checked = try rule(["last_checked_at": "2026-10-28T01:01:00Z", "last_value": 120, "last_triggered_at": NSNull()])
        #expect(original != checked && original.matchesDefinition(checked))
        for changed: [String: Any] in [["id": 2], ["symbol": "MSFT"], ["condition": "PRICE_BELOW"], ["threshold": 300], ["label": "Changed"], ["armed": 0], ["revision": 5], ["generation": "restored"], ["metric": "volume"]] {
            let edited = try rule(changed)
            #expect(!original.matchesDefinition(edited))
        }
    }
}
