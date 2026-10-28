import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct AlertEditingTests {
    private func fixture() async -> (TerminalModel, EditServer, EditRequests) {
        let server = EditServer(), requests = EditRequests()
        EditProtocol.handler = { requests.append($0.captured); server.handle($0) }
        let model = TerminalModel(defaults: EditDefaults(suiteName: "edit-memory-\(UUID())")!, credentials: EditCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [EditProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession(); await model.refreshAlerts()
        requests.clear(); return (model, server, requests)
    }
    private func editor(_ model: TerminalModel, locale: Locale = Locale(identifier: "en_US")) throws -> AlertEditState {
        let rule = try #require(model.alerts.first)
        return try #require(model.prepareAlertEdit(rule, locale: locale))
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        try #require(predicate(), "Expected alert edit did not start")
    }
    private func refreshed(_ model: TerminalModel) async throws { try await eventually { model.sectionUpdated[.alerts] != nil && !model.loadingSections.contains(.alerts) } }

    @Test func openingSharesAnUnchangedEditorAndPreservesExactLocaleValues() async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        server.set(["threshold": 0.00000001]); await model.refreshAlerts(); requests.clear()
        let state = try editor(model, locale: Locale(identifier: "de_DE")), reopened = try editor(model)
        #expect(state === reopened && state.threshold == "0,00000001" && state.label == "Saved" && !state.hasDraft)
        #expect(state.original?.armed == 0 && state.original?.repeat_seconds == 12345 && state.original?.symbol == "AAPL")
        #expect(requests.all.isEmpty)
    }
    @Test(arguments: [200, 204]) func acknowledgementFinishesBeforeRefreshAndPatchesOnlyThresholdAndLabel(status: Int) async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model, locale: Locale(identifier: "de_DE")), list = EditGate()
        state.threshold = "250,75"; state.label = " Changed "
        EditProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "PUT" { server.apply(request); request.respond(status, "") }
            else { list.hold(request) }
        }
        await model.saveAlertEdit(state); try await eventually { list.waiting }
        #expect(!state.saving && !state.hasDraft && state.savedRevision == 1 && state.message == "Alert updated.")
        let write = try #require(requests.writes.first), body = try #require(EditProtocol.body(write))
        #expect(Set(body.keys) == Set(["threshold", "label"]) && body["threshold"] as? Double == 250.75 && body["label"] as? String == "Changed")
        let query = URLComponents(url: write.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(query.contains(URLQueryItem(name: "revision", value: "1")) && query.contains(URLQueryItem(name: "generation", value: "g1")))
        #expect(write.value(forHTTPHeaderField: "Origin") == "https://first.example.com" && write.value(forHTTPHeaderField: "Authorization") == "Bearer test-edit-token")
        #expect(model.alerts.first?.threshold == 250.75 && model.alerts.first?.label == "Changed" && model.alerts.first?.revision == 2)
        #expect(model.alerts.first?.repeat_seconds == 12345 && model.alerts.first?.armed == 0 && model.alerts.first?.last_value == nil && model.alerts.first?.last_triggered_at != nil)
        #expect(model.pendingAlertActions.isEmpty && model.sectionUpdated[.alerts] == nil)
        list.release(using: server); try await refreshed(model)
    }
    @Test func reopenedPendingEditorBlocksOtherWritesAndCannotDiscard() async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model), gate = EditGate(), rule = try #require(model.alerts.first)
        state.threshold = "250"
        EditProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "PUT" { gate.hold(request) } else { server.handle(request) }
        }
        let save = Task { await model.saveAlertEdit(state) }; try await eventually { gate.waiting }
        let reopened = try editor(model)
        #expect(reopened === state && reopened.saving && model.isSavingAlertEdit(rule.id))
        reopened.discard(); await model.saveAlertEdit(reopened)
        await model.setArmed(rule, session: model.sessionID); await model.deleteAlert(rule, session: model.sessionID)
        #expect(requests.writes.count == 1 && reopened.threshold == "250")
        gate.release(using: server); await save.value; try await refreshed(model)
    }
    @Test(arguments: [false, true]) func newerEditsSurviveEvenWhenTheyReturnToTheSubmittedText(returnToOriginal: Bool) async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model), gate = EditGate(); state.threshold = "250"
        EditProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "PUT" { gate.hold(request) } else { server.handle(request) }
        }
        let save = Task { await model.saveAlertEdit(state) }; try await eventually { gate.waiting }
        state.threshold = "300"; if returnToOriginal { state.threshold = "250" }
        gate.release(using: server); await save.value; try await refreshed(model)
        #expect(state.hasDraft && state.threshold == (returnToOriginal ? "250" : "300") && state.original?.threshold == 250)
        #expect(state.savedRevision == 1 && state.message == "Alert updated. Newer edits are kept as a draft.")
        state.discard(); #expect(!state.hasDraft && state.threshold == "250")
    }
    @Test func failedWriteKeepsTheDraftForExplicitRetryAndEditingClearsFeedback() async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.label = "Changed"
        EditProtocol.handler = { requests.append($0.captured); $0.respond(503, "") }; await model.saveAlertEdit(state)
        #expect(state.error != nil && state.hasDraft && state.label == "Changed" && !state.saving && state.savedRevision == 0)
        state.label = "Retried"; #expect(state.error == nil)
        EditProtocol.handler = { requests.append($0.captured); server.handle($0) }; await model.saveAlertEdit(state); try await refreshed(model)
        #expect(requests.writes.count == 2 && state.error == nil && !state.hasDraft && state.original?.label == "Retried")
    }
    @Test func localDefinitionChangesBlockSavingWithoutARequest() async throws {
        let (model, _, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.threshold = "250"
        let original = try #require(model.alerts.first)
        model.alerts = [original.updating(AlertEdit(threshold: 300, label: "Other device"))]
        let reopened = try editor(model); #expect(reopened === state && state.needsReview && state.error != nil)
        state.label = "My edit"; #expect(state.error != nil)
        await model.saveAlertEdit(state)
        #expect(state.needsReview && state.hasDraft && state.threshold == "250" && requests.all.isEmpty)
    }
    @Test func ordinaryMonitorValuesDoNotInvalidateAnEditor() async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.label = "Changed"
        server.set(["last_value": 120, "last_checked_at": "2026-10-28T01:01:00Z"]); await model.refreshAlerts()
        await model.saveAlertEdit(state); try await refreshed(model)
        #expect(!state.needsReview && !state.hasDraft && state.original?.label == "Changed" && requests.writes.count == 1)
    }
    @Test func explicitReloadAdoptsAChangedMetricWithoutReapplyingTheOldThreshold() async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.threshold = "250"
        server.set(["condition": "CHANGE_BELOW", "threshold": -3.5, "revision": 2, "armed": 1]); await model.refreshAlerts()
        await model.saveAlertEdit(state); #expect(state.needsReview && requests.writes.isEmpty)
        await model.reloadAlertEdit(state)
        #expect(!state.hasDraft && state.threshold == "-3.5" && state.original?.condition == "CHANGE_BELOW")
        state.threshold = "-5"; await model.saveAlertEdit(state); try await refreshed(model)
        #expect(state.original?.threshold == -5 && state.original?.armed == 1 && state.original?.repeat_seconds == 12345)
    }
    @Test(arguments: [404, 409]) func conflictsNeverAutoRetryAndAnExplicitReloadStartsFromTheLatestRule(status: Int) async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.threshold = "250"
        server.set(["threshold": 300, "label": "Other device", "revision": 3])
        EditProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.httpMethod == "PUT" { request.respond(status, "") } else { server.handle(request) }
        }
        await model.saveAlertEdit(state); try await refreshed(model)
        #expect(state.needsReview && state.threshold == "250" && state.original?.revision == 1 && state.hasDraft)
        await model.saveAlertEdit(state); #expect(requests.writes.count == 1)
        await model.reloadAlertEdit(state)
        #expect(!state.needsReview && !state.hasDraft && state.threshold == "300.0" && state.label == "Other device" && state.original?.revision == 3)
        #expect(requests.writes.count == 1)
        EditProtocol.handler = { requests.append($0.captured); server.handle($0) }
        state.threshold = "350"; await model.saveAlertEdit(state); try await refreshed(model)
        #expect(state.original?.revision == 4 && state.original?.threshold == 350 && requests.writes.count == 2)
    }
    @Test(arguments: [200, 503]) func failedOrMissingReloadKeepsItsDraft(status: Int) async throws {
        let (model, _, _) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.threshold = "250"; let original = state.original
        EditProtocol.handler = { $0.respond(status, status == 200 ? #"{"alerts":[]}"# : "") }
        await model.reloadAlertEdit(state)
        #expect(state.original == original && state.threshold == "250" && state.hasDraft && state.error != nil && !state.reloading)
    }
    @Test func editsMadeDuringReloadCannotBeDiscardedByItsDelayedReply() async throws {
        let (model, server, _) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model), gate = EditGate(); state.threshold = "250"
        EditProtocol.handler = { gate.hold($0) }
        let reload = Task { await model.reloadAlertEdit(state) }; try await eventually { gate.waiting }
        state.threshold = "275"; server.set(["threshold": 300, "revision": 2])
        gate.release(using: server); await reload.value
        #expect(state.hasDraft && state.threshold == "275" && state.original?.revision == 1 && state.error != nil && !state.reloading)
    }
    @Test func aSupersededReloadCannotRebaseTheDraftOrSignOut() async throws {
        let (model, server, _) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model), old = EditGate(); state.threshold = "250"
        EditProtocol.handler = { old.hold($0) }
        let reload = Task { await model.reloadAlertEdit(state) }; try await eventually { old.waiting }
        server.set(["threshold": 300, "revision": 2]); EditProtocol.handler = { server.handle($0) }; await model.refreshAlerts()
        old.release(401, ""); await reload.value
        #expect(model.signedIn && state.hasDraft && state.threshold == "250" && state.original?.revision == 1 && state.error != nil)
    }
    @Test func currentUnauthorizedWriteClearsBothDraftAndReviewedRule() async throws {
        let (model, server, _) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.threshold = "250"
        EditProtocol.handler = { request in if request.request.httpMethod == "PUT" { request.respond(401, "") } else { server.handle(request) } }
        await model.saveAlertEdit(state)
        #expect(!model.signedIn && state.original == nil && state.threshold.isEmpty && state.label.isEmpty && !state.hasDraft && !state.saving)
        #expect(!model.isCurrentAlertEdit(state) && model.pendingAlertActions.isEmpty)
    }
    @Test(arguments: [200, 401]) func lateWritesCannotChangeAnEditorOnAnotherServer(status: Int) async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model), old = EditGate(), logout = EditGate(), latest = EditGate(), second = EditServer()
        state.threshold = "250"; second.set(["label": "Second server", "repeat_seconds": 3600])
        EditProtocol.handler = { request in
            requests.append(request.captured)
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "DELETE" { logout.hold(request) } else { old.hold(request) }
            } else if request.request.url?.path == "/api/alerts/1" { latest.hold(request) } else { second.handle(request) }
        }
        let first = Task { await model.saveAlertEdit(state) }; try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(state.original == nil && state.threshold.isEmpty && state.label.isEmpty)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true); await model.refreshAlerts()
        let current = try editor(model); current.threshold = "400"
        let save = Task { await model.saveAlertEdit(current) }; try await eventually { latest.waiting }
        if status == 200 { old.release(using: server) } else { old.release(status, "") }; await first.value
        #expect(model.signedIn && current.saving && current.threshold == "400" && current.original?.label == "Second server")
        #expect(current.savedRevision == 0 && state.savedRevision == 0 && model.pendingAlertActions == [1])
        logout.release(200, #"{"ok":true}"#); await signOut.value
        latest.release(using: second); await save.value; try await refreshed(model)
        #expect(current.original?.threshold == 400 && current.original?.repeat_seconds == 3600 && !current.hasDraft)
    }
    @Test func cancellingAWriteKeepsTheDraftAndReleasesAllProgress() async throws {
        let (model, _, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model), gate = EditGate(); state.threshold = "250"
        EditProtocol.handler = { requests.append($0.captured); gate.hold($0) }
        let save = Task { await model.saveAlertEdit(state) }; try await eventually { gate.waiting }
        save.cancel(); await save.value
        #expect(state.hasDraft && state.threshold == "250" && state.error == nil && !state.saving && model.pendingAlertActions.isEmpty && requests.writes.count == 1)
    }
    @Test func invalidThresholdAndOverlongLabelsNeverReachTheServer() async throws {
        let (model, _, requests) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model); state.threshold = "0"; await model.saveAlertEdit(state)
        #expect(state.error != nil && requests.writes.isEmpty)
        state.threshold = "250"; state.label = String(repeating: "😀", count: 61); await model.saveAlertEdit(state)
        #expect(state.error == "Use a label of up to 120 characters." && requests.writes.isEmpty)
    }
    @Test func unsupportedRulesAndMissingVersionsCannotOpenAnEditor() async throws {
        let (model, server, requests) = await fixture(); defer { EditProtocol.handler = nil }
        _ = try editor(model)
        server.set(["revision": NSNull()]); await model.refreshAlerts(); requests.clear()
        let old = try #require(model.alerts.first)
        #expect(model.prepareAlertEdit(old) == nil && model.alertActionErrors[old.id] != nil && requests.all.isEmpty)
        server.set(["revision": 1, "metric": "future"]); await model.refreshAlerts(); requests.clear()
        let future = try #require(model.alerts.first)
        #expect(model.prepareAlertEdit(future) == nil && model.alertActionErrors[future.id] == "This alert type or threshold cannot be edited on this phone." && requests.all.isEmpty)
    }
    @Test func anOlderAcknowledgementCannotOverwriteANewerRuleAlreadyObserved() async throws {
        let (model, server, _) = await fixture(); defer { EditProtocol.handler = nil }
        let state = try editor(model), write = EditGate(), list = EditGate(); state.threshold = "250"
        EditProtocol.handler = { request in if request.request.httpMethod == "PUT" { write.hold(request) } else { list.hold(request) } }
        let save = Task { await model.saveAlertEdit(state) }; try await eventually { write.waiting }
        let original = try #require(model.alerts.first), fresh = original.updating(AlertEdit(threshold: 300, label: "Newer")).updating(AlertEdit(threshold: 350, label: "Newest"))
        model.alerts = [fresh]; state.threshold = "275"
        write.release(using: server); await save.value
        #expect(model.alerts == [fresh] && state.hasDraft && state.threshold == "275" && state.original?.revision == 2)
        await model.saveAlertEdit(state); #expect(state.needsReview)
        try await eventually { list.waiting }; server.set(["threshold": 350, "label": "Newest", "revision": 3]); list.release(using: server); try await refreshed(model)
    }
}

@MainActor private final class EditCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "test-edit-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class EditDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
    override func integer(forKey key: String) -> Int { 0 }
}
private final class EditRequests: @unchecked Sendable {
    private let lock = NSLock(); private var values: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { values } }
    var writes: [URLRequest] { all.filter { $0.httpMethod == "PUT" } }
    func append(_ value: URLRequest) { lock.withLock { values.append(value) } }
    func clear() { lock.withLock { values = [] } }
}
private final class EditGate: @unchecked Sendable {
    private let lock = NSLock(); private var held: EditProtocol?
    var waiting: Bool { lock.withLock { held != nil } }
    func hold(_ value: EditProtocol) { lock.withLock { held = value } }
    private func take() -> EditProtocol? { lock.withLock { let value = held; held = nil; return value } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func release(using server: EditServer) { if let request = take() { server.handle(request) } }
}
private final class EditServer: @unchecked Sendable {
    private let lock = NSLock()
    private var rule: [String: Any] = ["id": 1, "symbol": "AAPL", "condition": "PRICE_ABOVE", "threshold": 200.5, "label": "Saved", "armed": 0, "revision": 1, "generation": "g1", "metric": "native", "repeat_seconds": 12345, "last_checked_at": "2026-10-28T01:00:00Z", "last_value": 110, "last_triggered_at": "2026-10-27T12:00:00Z"]
    func set(_ values: [String: Any]) { lock.withLock { rule.merge(values) { _, new in new } } }
    func apply(_ request: EditProtocol) {
        let body = EditProtocol.body(request.captured) ?? [:]
        lock.withLock { rule.merge(body) { _, new in new }; rule["revision"] = (rule["revision"] as? Int ?? 0) + 1; rule["last_checked_at"] = NSNull(); rule["last_value"] = NSNull() }
    }
    func handle(_ request: EditProtocol) {
        if request.request.httpMethod == "DELETE" { request.respond(200, #"{"ok":true}"#) }
        else if request.request.url?.path == "/api/mobile/session" { request.respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if request.request.httpMethod == "PUT" { apply(request); request.respond(200, #"{"id":1}"#) }
        else {
            let data = lock.withLock { try! JSONSerialization.data(withJSONObject: ["alerts": [rule]]) }
            request.respond(200, String(decoding: data, as: UTF8.self))
        }
    }
}
private final class EditProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (EditProtocol) -> Void)?
    private let lock = NSLock(); private var stopped = false; private var payload: Data?
    var captured: URLRequest { var value = request; value.httpBody = payload; return value }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        payload = request.httpBody
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096), data = Data()
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
            payload = data
        }
        Self.handler?(self)
    }
    override func stopLoading() { lock.withLock { stopped = true } }
    func respond(_ status: Int, _ body: String) {
        guard !lock.withLock({ stopped }) else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    static func body(_ request: URLRequest) -> [String: Any]? { request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
}
