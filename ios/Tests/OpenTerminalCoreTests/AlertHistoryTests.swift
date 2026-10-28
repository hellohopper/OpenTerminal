import Foundation
import Testing
@testable import OpenTerminalCore

struct AlertHistoryTests {
    @Test func deletedRulesAndLegacyMetricsDecodeWithIndependentTimes() throws {
        let page = try JSONDecoder().decode(AlertHistoryPage.self, from: Data(#"{"events":[{"id":50,"alert_id":null,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":100,"label":"Past trigger","value":110,"price":110,"currency":"USD","source":"fixture","observed_at":"2026-10-24T13:00:00Z","created_at":"2026-10-24T13:00:05.500Z"}],"nextCursor":50}"#.utf8))
        let row = try #require(page.events.first)
        #expect(page.nextCursor == 50 && row.alert_id == nil && row.metric == nil)
        #expect(row.valueKind == .price && row.conditionLabelKey == "Price ≥")
        let recorded = try #require(row.recordedAt), observed = try #require(row.observedAt)
        #expect(recorded.timeIntervalSince(observed) == 5.5)
    }
    @Test(arguments: [
        ("native", "PRICE_ABOVE", AlertValueKind.price, "Price ≥"),
        ("native", "PRICE_BELOW", .price, "Price ≤"),
        ("native", "CHANGE_ABOVE", .dailyChange, "Day change ≥"),
        ("native", "CHANGE_BELOW", .dailyChange, "Day change ≤"),
        ("volume", "PRICE_ABOVE", .volume, "Volume ≥"),
        ("volume", "PRICE_BELOW", .volume, "Volume ≤"),
        ("future", "PRICE_ABOVE", .unknown, "PRICE_ABOVE"),
        ("native", "FUTURE_CONDITION", .unknown, "FUTURE_CONDITION"),
        ("volume", "CHANGE_ABOVE", .unknown, "CHANGE_ABOVE")
    ]) func measuresDoNotConfuseVolumeOrUnknownValuesWithPrices(metric: String, condition: String, kind: AlertValueKind, label: String) {
        #expect(alertValueKind(metric: metric, condition: condition) == kind)
        #expect(alertConditionLabel(metric: metric, condition: condition) == label)
    }
    @Test func localRuleAcknowledgementPreservesTheMetricAndVersion() throws {
        let rule = try JSONDecoder().decode(AlertRule.self, from: Data(#"{"id":1,"symbol":"AAPL","condition":"PRICE_BELOW","threshold":100000,"label":"Volume","armed":1,"metric":"volume","revision":3,"generation":"instance"}"#.utf8))
        let paused = rule.settingArmed(false)
        #expect(paused.metric == "volume" && paused.valueKind == .volume && paused.conditionLabelKey == "Volume ≤")
        #expect(paused.armed == 0 && paused.revision == 4 && paused.generation == rule.generation)
    }
    @Test func missingQuoteTimesAndMalformedDatesStayUnavailable() throws {
        let page = try JSONDecoder().decode(AlertHistoryPage.self, from: Data(#"{"events":[{"id":1,"alert_id":2,"symbol":"AAPL","condition":"CHANGE_ABOVE","threshold":1,"label":"","value":2,"price":110,"currency":null,"source":"fixture","observed_at":null,"created_at":"unavailable"}],"nextCursor":null}"#.utf8))
        let row = try #require(page.events.first)
        #expect(row.recordedAt == nil && row.observedAt == nil && page.nextCursor == nil)
        #expect(row.valueKind == .dailyChange)
    }
}
