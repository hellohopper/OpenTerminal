import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct AlertEditorTests {
    private func fixture() async throws -> (TerminalModel, AlertRequests) {
        let requests = AlertRequests()
        AlertProtocol.handler = { request in requests.append(request.request); request.fixture() }
        let model = TerminalModel(defaults: AlertDefaults(suiteName: "alert-memory-\(UUID())")!, credentials: AlertCredentials()) { server, credential in
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AlertProtocol.self]
            return TerminalAPI(server: server, credential: credential, configuration: config)
        }
        model.serverText = "https://first.example.com"; await model.restoreSession(); requests.clear()
        return (model, requests)
    }
    private func populate(_ state: AlertEditorState) {
        state.draft = AlertDraft(symbol: " aapl ", threshold: " 200.5 ", label: " Price target ", condition: "PRICE_ABOVE")
    }
    private func rule(id: Int = 1, armed: Int = 1, revision: Int = 1, generation: String = "g1") throws -> AlertRule {
        try JSONDecoder().decode(AlertRule.self, from: Data("{\"id\":\(id),\"symbol\":\"AAPL\",\"condition\":\"PRICE_ABOVE\",\"threshold\":200,\"label\":\"Target\",\"armed\":\(armed),\"revision\":\(revision),\"generation\":\"\(generation)\"}".utf8))
    }
    private func eventually(_ predicate: () -> Bool) async throws {
        for _ in 0..<200 { if predicate() { return }; try await Task.sleep(for: .milliseconds(5)) }
        #expect(predicate(), "Expected alert operation did not start")
    }

    @Test func acknowledgedSaveFinishesBeforeTheListRefreshAndPreservesTheRequest() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor, gate = AlertGate(); populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { gate.hold(request) } else { request.fixture() }
        }
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX"))
        #expect(!state.saving && !state.hasDraft && state.savedRevision == 1 && state.message == "Alert saved.")
        try await eventually { gate.waiting }
        #expect(requests.all.allSatisfy { $0.url?.path == "/api/alerts" })
        let post = try #require(requests.all.first { $0.httpMethod == "POST" })
        let body = try #require(AlertProtocol.body(post))
        #expect(body["symbol"] as? String == "AAPL" && body["threshold"] as? Double == 200.5)
        #expect(body["label"] as? String == "Price target" && body["condition"] as? String == "PRICE_ABOVE")
        gate.releaseFixture(); try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test func reopenedEditorSharesPendingSaveAndCannotSubmitAgain() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor, gate = AlertGate(); populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { request.fixture() }
        }
        let save = Task { await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX")) }; try await eventually { gate.waiting }
        let reopened = model.alertEditor
        #expect(reopened === state && reopened.saving)
        reopened.discard(); #expect(reopened.hasDraft)
        await model.saveAlert(reopened, locale: Locale(identifier: "en_US_POSIX"))
        #expect(requests.all.filter { $0.httpMethod == "POST" }.count == 1)
        gate.releaseFixture(); await save.value
        #expect(!reopened.hasDraft && !reopened.saving && reopened.savedRevision == 1)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [false, true]) func successfulSaveKeepsNewerEditsEvenWhenTheyReturnToTheSameText(returnToOriginal: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor, gate = AlertGate(); populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { gate.hold(request) } else { request.fixture() }
        }
        let save = Task { await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX")) }; try await eventually { gate.waiting }
        let reopened = model.alertEditor
        reopened.draft.threshold = "250"
        if returnToOriginal { reopened.draft.threshold = " 200.5 " }
        gate.releaseFixture(); await save.value
        #expect(reopened.hasDraft && !reopened.saving && reopened.savedRevision == 1)
        #expect(reopened.draft.threshold == (returnToOriginal ? " 200.5 " : "250"))
        #expect(reopened.message == "Alert saved. Newer edits are kept as a draft.")
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test func failedWriteKeepsItsDraftAndEditingClearsTheErrorForRetry() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); let original = state.draft
        AlertProtocol.handler = { request in requests.append(request.request); request.respond(503, #"{"error":"Retry later"}"#) }
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX"))
        #expect(state.draft == original && state.error != nil && !state.saving && state.savedRevision == 0)
        let reopened = model.alertEditor; reopened.draft.label = "Revised target"
        #expect(reopened.error == nil)
        AlertProtocol.handler = { request in requests.append(request.request); request.fixture() }
        await model.saveAlert(reopened, locale: Locale(identifier: "en_US_POSIX"))
        #expect(!reopened.hasDraft && reopened.savedRevision == 1)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [201, 401]) func oldSaveCannotDismissClearOrSignOutANewerSession(status: Int) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let oldState = model.alertEditor, post = AlertGate(), logout = AlertGate(), newPost = AlertGate(); populate(oldState)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.host == "first.example.com" {
                if request.request.httpMethod == "POST" { post.hold(request) }
                else if request.request.httpMethod == "DELETE" { logout.hold(request) }
                else { request.fixture() }
            } else if request.request.httpMethod == "POST" { newPost.hold(request) }
            else { request.fixture() }
        }
        let oldSave = Task { await model.saveAlert(oldState, locale: Locale(identifier: "en_US_POSIX")) }; try await eventually { post.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(oldState.draft.isEmpty && !oldState.saving)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        let current = model.alertEditor; populate(current); current.draft.label = "Second server target"
        let save = Task { await model.saveAlert(current, locale: Locale(identifier: "en_US_POSIX")) }; try await eventually { newPost.waiting }
        post.release(status, #"{"id":1}"#); await oldSave.value
        #expect(model.signedIn && model.server?.origin.host == "second.example.com" && model.error == nil)
        #expect(current.saving && current.draft.label == "Second server target" && current.savedRevision == 0)
        #expect(oldState.message == nil && oldState.error == nil && oldState.savedRevision == 0)
        #expect(!requests.all.contains { $0.url?.host == "first.example.com" && $0.httpMethod == "GET" && $0.url?.path == "/api/alerts" })
        logout.releaseFixture(); await signOut.value
        newPost.releaseFixture(); await save.value
        #expect(!current.hasDraft && current.savedRevision == 1)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test func signedOutEditorCannotRestoreItsDraftOrWriteThroughANewConnection() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let old = model.alertEditor; populate(old); await model.signOut()
        #expect(old.draft.isEmpty && old !== model.alertEditor)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true)
        populate(old); await model.saveAlert(old, locale: Locale(identifier: "en_US_POSIX"))
        #expect(model.alertEditor.draft.isEmpty && !model.alertEditor.saving)
        #expect(!requests.all.contains { $0.httpMethod == "POST" })
    }

    @Test func refreshFailureDoesNotTurnAnAcknowledgedWriteIntoASaveError() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { request.respond(503, #"{"error":"List temporarily unavailable"}"#) }
            else { request.fixture() }
        }
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX")); try await eventually { model.sectionErrors[.alerts] != nil }
        #expect(!state.hasDraft && !state.saving && state.error == nil && state.savedRevision == 1)
        #expect(state.message == "Alert saved.")
    }

    @Test func currentAuthorizationFailureClearsTheEditorAndRequiresSignIn() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { request.respond(401, #"{"error":"Revoked"}"#) } else { request.fixture() }
        }
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX"))
        #expect(!model.signedIn && model.error != nil && state.draft.isEmpty && !state.saving)
        #expect(state !== model.alertEditor && model.alertEditor.draft.isEmpty)
    }

    @Test(arguments: ["0", "-1", "nan", "inf", "1e16", "not-a-price"]) func invalidPricesNeverReachTheBackend(price: String) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.draft.threshold = price
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX"))
        #expect(state.error != nil && !state.saving && state.hasDraft && requests.all.isEmpty)
    }

    @Test func invalidTickerConditionAndOverlongUnicodeLabelsAreRejectedWithoutTruncation() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.draft.symbol = "<script>"
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX")); #expect(state.error != nil)
        populate(state); state.draft.condition = "OTHER"
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX")); #expect(state.error != nil)
        populate(state); state.draft.label = String(repeating: "😀", count: 61)
        await model.saveAlert(state, locale: Locale(identifier: "en_US_POSIX"))
        #expect(state.error == "Use a label of up to 120 characters.")
        #expect(state.draft.label == String(repeating: "😀", count: 61) && requests.all.isEmpty)
    }

    @Test func discardingAnUnsavedDraftClearsOnlyTheCurrentEditor() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.error = "Old error"
        state.discard()
        #expect(!state.hasDraft && state.error == nil && state.message == nil && requests.all.isEmpty)
    }

    @Test(arguments: AlertTrigger.allCases) func allAlertTypesSubmitNumericThresholdsAndTheCorrectMetric(type: AlertTrigger) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.selectTrigger(type)
        let value = type == .dailyFall ? -3.5 : type == .dailyRise ? 3.5 : type.metric == "volume" ? 100000.5 : 200.5
        state.draft.threshold = type == .dailyFall ? "-3,5" : type == .dailyRise ? "3,5" : type.metric == "volume" ? "100000,5" : "200,5"
        await model.saveAlert(state, locale: Locale(identifier: "de_DE"))
        let post = try #require(requests.all.first { $0.httpMethod == "POST" }), body = try #require(AlertProtocol.body(post))
        #expect(body["threshold"] as? Double == value && body["metric"] as? String == type.metric && body["condition"] as? String == type.condition)
        #expect(body["symbol"] as? String == "AAPL" && body["label"] as? String == "Price target" && body["armed"] as? Bool == true)
        #expect(!state.hasDraft && state.error == nil && state.savedRevision == 1 && !state.saving)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [(AlertTrigger.dailyFall, "3.5"), (.dailyFall, "-100.01"), (.dailyRise, "-3.5"), (.dailyRise, "1000000.01"), (.volumeAbove, "0"), (.volumeBelow, "-10"), (.dailyRise, "3.5%")])
    func invalidThresholdForTheSelectedTypeKeepsTheDraftWithoutWriting(type: AlertTrigger, input: String) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.selectTrigger(type); state.draft.threshold = input
        let draft = state.draft
        await model.saveAlert(state, locale: Locale(identifier: "en_US"))
        #expect(state.draft == draft && state.error == type.validationKey && !state.saving && state.savedRevision == 0 && requests.all.isEmpty)
    }

    @Test func unsupportedMetricAndConditionCannotCreateAPriceRuleByAccident() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.draft.metric = "future"
        await model.saveAlert(state)
        #expect(state.error == "Choose a supported alert type." && requests.all.isEmpty)
        state.draft.metric = "volume"; state.draft.condition = "CHANGE_ABOVE"
        await model.saveAlert(state)
        #expect(state.error == "Choose a supported alert type." && requests.all.isEmpty && state.hasDraft)
    }

    @Test func choosingAnotherTypeClearsOnlyItsThresholdAndCountsAsAnUnsavedEdit() {
        let state = AlertEditorState(); populate(state); state.error = "Previous failure"
        let previous = state.revision
        state.selectTrigger(.dailyFall)
        #expect(state.draft.trigger == .dailyFall && state.draft.threshold.isEmpty && state.draft.symbol == " aapl " && state.draft.label == " Price target ")
        #expect(state.revision == previous + 1 && state.hasDraft && state.error == nil)
        state.draft.threshold = "-3.5"; let same = state.revision; state.selectTrigger(.dailyFall)
        #expect(state.draft.threshold == "-3.5" && state.revision == same)
        state.discard(); #expect(state.draft.trigger == .priceAbove && !state.hasDraft)
        state.selectTrigger(.volumeAbove); #expect(state.hasDraft)
        state.discard(); #expect(!state.hasDraft)
    }

    @Test(arguments: [false, true]) func aTypeChangeDuringSavePreservesNewerEditsAndTheSubmittedUnits(returnToOriginal: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor, write = AlertGate(); populate(state)
        state.selectTrigger(.dailyFall); state.draft.threshold = "-3.5"
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "POST" { write.hold(request) } else { request.fixture() }
        }
        let save = Task { await model.saveAlert(state, locale: Locale(identifier: "en_US")) }; try await eventually { write.waiting }
        state.selectTrigger(.volumeAbove); state.draft.threshold = "100000"
        if returnToOriginal { state.selectTrigger(.dailyFall); state.draft.threshold = "-3.5" }
        let draft = state.draft
        await model.saveAlert(state); #expect(requests.all.filter { $0.httpMethod == "POST" }.count == 1)
        write.releaseFixture(); await save.value
        let post = try #require(requests.all.first { $0.httpMethod == "POST" }), body = try #require(AlertProtocol.body(post))
        #expect(body["threshold"] as? Double == -3.5 && body["condition"] as? String == "CHANGE_BELOW" && body["metric"] as? String == "native")
        #expect(state.draft == draft && state.hasDraft && !state.saving && state.savedRevision == 1 && state.message == "Alert saved. Newer edits are kept as a draft.")
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [AlertTrigger.dailyRise, .dailyFall]) func explicitZeroPercentThresholdIsValid(type: AlertTrigger) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.selectTrigger(type); state.draft.threshold = "0"
        await model.saveAlert(state, locale: Locale(identifier: "en_US"))
        let post = try #require(requests.all.first { $0.httpMethod == "POST" }), body = try #require(AlertProtocol.body(post))
        #expect(body["threshold"] as? Double == 0 && state.error == nil && !state.hasDraft)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: ["en_US", "zh_CN", "fr_FR", "ar_EG"]) func localizedPricesAreSentAsNumbersAndClearOnlyTheSubmittedDraft(identifier: String) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state)
        state.draft.threshold = identifier == "fr_FR" ? "200,5" : identifier == "ar_EG" ? "٢٠٠٫٥" : "200.5"
        await model.saveAlert(state, locale: Locale(identifier: identifier))
        #expect(!state.hasDraft && !state.saving && state.error == nil && state.savedRevision == 1)
        let post = try #require(requests.all.first { $0.httpMethod == "POST" })
        let body = try #require(AlertProtocol.body(post))
        #expect(body["threshold"] as? Double == 200.5)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: ["1.234", "1.234,5", "200,5 EUR", "200.5"]) func groupedOrWrongLocalePricesKeepTheDraftWithoutWriting(input: String) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let state = model.alertEditor; populate(state); state.draft.threshold = input
        await model.saveAlert(state, locale: Locale(identifier: "de_DE"))
        #expect(state.error != nil && state.hasDraft && !state.saving && state.draft.threshold == input && requests.all.isEmpty)
    }

    @Test(arguments: [false, true], [0, 1]) func pendingRuleActionBlocksDuplicateAndCompetingWrites(deleting: Bool, originalArmed: Int) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let row = try rule(armed: originalArmed), write = AlertGate(), list = AlertGate(); model.alerts = [row]
        let session = model.sessionID
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { list.hold(request) } else { write.hold(request) }
        }
        let action = Task {
            if deleting { await model.deleteAlert(row, session: session) }
            else { await model.setArmed(row, session: session) }
        }
        try await eventually { write.waiting }
        #expect(model.pendingAlertActions == [row.id] && model.alerts == [row])
        await model.setArmed(row, session: session); await model.deleteAlert(row, session: session)
        #expect(requests.all.count == 1)
        #expect(requests.all.first?.httpMethod == (deleting ? "DELETE" : "PUT"))
        let parameters = URLComponents(url: try #require(requests.all.first?.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(parameters.contains(URLQueryItem(name: "revision", value: "1")) && parameters.contains(URLQueryItem(name: "generation", value: "g1")))
        if !deleting {
            #expect(AlertProtocol.body(try #require(requests.all.first))?["armed"] as? Bool == (originalArmed == 0))
        }
        write.release(204, ""); await action.value
        #expect(model.pendingAlertActions.isEmpty && model.alertActionErrors.isEmpty)
        #expect(deleting ? model.alerts.isEmpty : model.alerts == [row.settingArmed(originalArmed == 0)])
        try await eventually { list.waiting }
        #expect(requests.all.allSatisfy { ["/api/alerts", "/api/alerts/1"].contains($0.url?.path ?? "") })
        list.release(200, deleting ? #"{"alerts":[]}"# : "{\"alerts\":[{\"id\":1,\"symbol\":\"AAPL\",\"condition\":\"PRICE_ABOVE\",\"threshold\":200,\"label\":\"Target\",\"armed\":\(originalArmed == 0 ? 1 : 0)}]}")
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [false, true]) func failedRuleActionKeepsTheRowAndAllowsRetry(deleting: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let row = try rule(); model.alerts = [row]; let session = model.sessionID
        AlertProtocol.handler = { request in requests.append(request.request); request.respond(409, #"{"error":"Review this rule"}"#) }
        if deleting { await model.deleteAlert(row, session: session) } else { await model.setArmed(row, session: session) }
        #expect(model.alerts == [row] && model.pendingAlertActions.isEmpty && model.alertActionErrors[row.id] != nil)
        #expect(model.signedIn && model.error == nil && !model.reconnecting && requests.all.count == 1)
        AlertProtocol.handler = { request in requests.append(request.request); request.fixture() }
        if deleting { await model.deleteAlert(row, session: session) } else { await model.setArmed(row, session: session) }
        #expect(model.alertActionErrors.isEmpty && model.pendingAlertActions.isEmpty)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [false, true], [200, 401]) func snapshotsStartedBeforeAWriteCannotRestoreOldState(deleting: Bool, oldStatus: Int) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let row = try rule(), old = AlertGate(), latest = AlertGate(); model.alerts = [row]
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" {
                if requests.all.filter({ $0.httpMethod == "GET" }).count == 1 { old.hold(request) } else { latest.hold(request) }
            } else { request.respond(204, "") }
        }
        let refresh = Task { await model.refreshAlerts() }; try await eventually { old.waiting }
        if deleting { await model.deleteAlert(row, session: model.sessionID) } else { await model.setArmed(row, session: model.sessionID) }
        try await eventually { latest.waiting }
        old.release(oldStatus, #"{"alerts":[{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":200,"label":"Target","armed":1}]}"#)
        await refresh.value
        #expect(model.signedIn && model.error == nil && model.sectionErrors[.alerts] == nil)
        #expect(deleting ? model.alerts.isEmpty : model.alerts == [row.settingArmed(false)])
        #expect(model.loadingSections.contains(.alerts))
        latest.release(200, #"{"alerts":[]}"#); try await eventually { !model.loadingSections.contains(.alerts) }
    }

    @Test(arguments: [false, true]) func listRefreshFailureDoesNotUndoAnAcknowledgedAction(deleting: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let row = try rule(); model.alerts = [row]
        AlertProtocol.handler = { request in
            requests.append(request.request)
            request.respond(request.request.httpMethod == "GET" ? 503 : 204, #"{"error":"List unavailable"}"#)
        }
        if deleting { await model.deleteAlert(row, session: model.sessionID) } else { await model.setArmed(row, session: model.sessionID) }
        try await eventually { model.sectionErrors[.alerts] != nil }
        #expect(model.pendingAlertActions.isEmpty && model.alertActionErrors.isEmpty)
        #expect(deleting ? model.alerts.isEmpty : model.alerts == [row.settingArmed(false)])
    }

    @Test(arguments: [false, true], [204, 401]) func oldRuleActionCannotChangeANewerSessionOrItsPendingAction(deleting: Bool, status: Int) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let row = try rule(), old = AlertGate(), logout = AlertGate(), latest = AlertGate(); model.alerts = [row]
        let oldSession = model.sessionID
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.host == "first.example.com" {
                if request.request.url?.path == "/api/alerts/1" { old.hold(request) }
                else if request.request.httpMethod == "DELETE" { logout.hold(request) }
                else { request.fixture() }
            } else if request.request.url?.path == "/api/alerts/1" { latest.hold(request) }
            else { request.fixture() }
        }
        let oldAction = Task {
            if deleting { await model.deleteAlert(row, session: oldSession) } else { await model.setArmed(row, session: oldSession) }
        }
        try await eventually { old.waiting }
        let signOut = Task { await model.signOut() }; try await eventually { logout.waiting }
        #expect(model.pendingAlertActions.isEmpty && model.alertActionErrors.isEmpty)
        model.serverText = "https://second.example.com"; await model.restoreSession(force: true); model.alerts = [row]
        let session = model.sessionID
        // A confirmation captured on the previous server must not operate on an equal ID here.
        await model.deleteAlert(row, session: oldSession); await model.setArmed(row, session: oldSession)
        #expect(!latest.waiting)
        let action = Task { await model.setArmed(row, session: session) }; try await eventually { latest.waiting }
        old.release(status, ""); await oldAction.value
        #expect(model.signedIn && model.server?.origin.host == "second.example.com" && model.error == nil)
        #expect(model.pendingAlertActions == [row.id] && model.alerts == [row] && model.alertActionErrors.isEmpty)
        logout.releaseFixture(); await signOut.value
        latest.release(204, ""); await action.value
        #expect(model.pendingAlertActions.isEmpty)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [false, true]) func currentRuleAuthorizationFailureClearsActionsAndRequiresSignIn(deleting: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let row = try rule(); model.alerts = [row]
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.url?.path == "/api/alerts/1" { request.respond(401, "") } else { request.fixture() }
        }
        if deleting { await model.deleteAlert(row, session: model.sessionID) } else { await model.setArmed(row, session: model.sessionID) }
        #expect(!model.signedIn && model.error != nil && model.alerts.isEmpty)
        #expect(model.pendingAlertActions.isEmpty && model.alertActionErrors.isEmpty)
    }

    @Test func changedOrMissingRulesAreNotWrittenFromStaleControls() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let old = try rule(), current = old.settingArmed(false); model.alerts = [current]
        await model.deleteAlert(old, session: model.sessionID); await model.setArmed(old, session: model.sessionID)
        #expect(model.alerts == [current] && model.alertActionErrors[old.id] != nil && requests.all.isEmpty)
        model.alerts = []
        await model.deleteAlert(current, session: model.sessionID)
        #expect(requests.all.isEmpty && model.pendingAlertActions.isEmpty)
    }

    @Test(arguments: [false, true]) func aMonitorTickDoesNotInvalidateAReviewedRuleAction(deleting: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let reviewed = try rule(), checked = try JSONDecoder().decode(AlertRule.self, from: Data(#"{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":200,"label":"Target","armed":1,"revision":1,"generation":"g1","last_checked_at":"2026-10-28T01:00:00Z","last_value":110,"last_triggered_at":"2026-10-27T12:00:00Z"}"#.utf8))
        model.alerts = [checked]; let write = AlertGate(), list = AlertGate()
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { list.hold(request) } else { write.hold(request) }
        }
        let action = Task {
            if deleting { await model.deleteAlert(reviewed, session: model.sessionID) } else { await model.setArmed(reviewed, session: model.sessionID) }
        }
        try await eventually { write.waiting }
        #expect(model.alertActionErrors.isEmpty && model.pendingAlertActions == [reviewed.id])
        let request = try #require(requests.all.first)
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(query.contains(URLQueryItem(name: "revision", value: "1")) && query.contains(URLQueryItem(name: "generation", value: "g1")))
        write.release(deleting ? 204 : 200, deleting ? "" : #"{"id":1}"#); await action.value
        if deleting { #expect(model.alerts.isEmpty) }
        else {
            let paused = try #require(model.alerts.first)
            #expect(paused.armed == 0 && paused.last_checked_at == nil && paused.last_value == nil && paused.last_triggered_at == checked.last_triggered_at)
        }
        #expect(model.pendingAlertActions.isEmpty && model.alertActionErrors.isEmpty)
        try await eventually { list.waiting }; list.releaseFixture(); try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [false, true]) func changedRuleFieldsStillNeedReviewEvenWithTheSameVersion(deleting: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let reviewed = try rule(), changed = try JSONDecoder().decode(AlertRule.self, from: Data(#"{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":300,"label":"Target","armed":1,"revision":1,"generation":"g1","last_checked_at":"2026-10-28T01:00:00Z","last_value":110}"#.utf8))
        model.alerts = [changed]
        if deleting { await model.deleteAlert(reviewed, session: model.sessionID) } else { await model.setArmed(reviewed, session: model.sessionID) }
        #expect(model.alertActionErrors[reviewed.id] != nil && model.alerts == [changed] && requests.all.isEmpty)
    }

    @Test func cancelingAPendingRuleWriteClearsProgressWithoutAnErrorOrRetry() async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let row = try rule(), gate = AlertGate(); model.alerts = [row]
        AlertProtocol.handler = { request in requests.append(request.request); gate.hold(request) }
        let action = Task { await model.deleteAlert(row, session: model.sessionID) }; try await eventually { gate.waiting }
        action.cancel(); await action.value
        #expect(model.alerts == [row] && model.pendingAlertActions.isEmpty && model.alertActionErrors.isEmpty)
        #expect(requests.all.count == 1)
        gate.release(204, "")
    }

    @Test(arguments: [false, true]) func missingAlertVersionsRequireABackendUpdateWithoutWriting(deleting: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let legacy = try JSONDecoder().decode(AlertRule.self, from: Data(#"{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":200,"label":"Old server","armed":1}"#.utf8))
        model.alerts = [legacy]
        if deleting { await model.deleteAlert(legacy, session: model.sessionID) } else { await model.setArmed(legacy, session: model.sessionID) }
        #expect(model.alerts == [legacy] && model.alertActionErrors[legacy.id]?.contains("Update the Mac") == true)
        #expect(requests.all.isEmpty && model.pendingAlertActions.isEmpty)
    }

    @Test(arguments: [false, true], [false, true]) func refreshedRevisionOrRestoredGenerationRejectsAnOlderControl(deleting: Bool, restored: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let old = try rule(), fresh = try rule(revision: restored ? 1 : 2, generation: restored ? "restored" : "g1")
        model.alerts = [fresh]
        if deleting { await model.deleteAlert(old, session: model.sessionID) } else { await model.setArmed(old, session: model.sessionID) }
        #expect(model.alerts == [fresh] && model.alertActionErrors[old.id] != nil && requests.all.isEmpty)
    }

    @Test(arguments: [false, true]) func conflictKeepsTheRuleUntilItIsRefreshedAndReviewed(deleting: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let old = try rule(), fresh = try rule(revision: 2); model.alerts = [old]
        AlertProtocol.handler = { request in requests.append(request.request); request.respond(409, #"{"error":"This alert changed on another device or was restored. Refresh alerts and review it before trying again."}"#) }
        if deleting { await model.deleteAlert(old, session: model.sessionID) } else { await model.setArmed(old, session: model.sessionID) }
        #expect(model.alerts == [old] && model.alertActionErrors[old.id] != nil && model.signedIn && !model.reconnecting)
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { request.respond(200, #"{"alerts":[{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":200,"label":"Target","armed":1,"revision":2,"generation":"g1"}]}"#) }
            else { request.respond(204, "") }
        }
        await model.refreshAlerts(); #expect(model.alerts == [fresh])
        let count = requests.all.count
        if deleting { await model.deleteAlert(old, session: model.sessionID) } else { await model.setArmed(old, session: model.sessionID) }
        #expect(requests.all.count == count)
        if deleting { await model.deleteAlert(fresh, session: model.sessionID) } else { await model.setArmed(fresh, session: model.sessionID) }
        let write = try #require(requests.all.last { $0.httpMethod != "GET" })
        #expect(write.url?.query?.contains("revision=2") == true && model.alertActionErrors.isEmpty)
        try await eventually { model.sectionUpdated[.alerts] != nil }
    }

    @Test(arguments: [false, true], [false, true]) func delayedAcknowledgementPreservesANewerVersionAlreadySeenByRefresh(deleting: Bool, restored: Bool) async throws {
        let (model, requests) = try await fixture(); defer { AlertProtocol.handler = nil }
        let original = try rule(), latest = try rule(revision: restored ? 1 : 2, generation: restored ? "restored" : "g1")
        let write = AlertGate(), list = AlertGate(); model.alerts = [original]
        AlertProtocol.handler = { request in
            requests.append(request.request)
            if request.request.httpMethod == "GET" { list.hold(request) } else { write.hold(request) }
        }
        let action = Task {
            if deleting { await model.deleteAlert(original, session: model.sessionID) } else { await model.setArmed(original, session: model.sessionID) }
        }
        try await eventually { write.waiting }
        model.alerts = [latest] // The periodic refresh observed a later edit/restore before the older acknowledgement arrived.
        write.release(204, ""); await action.value
        #expect(model.alerts == [latest] && model.pendingAlertActions.isEmpty && model.alertActionErrors.isEmpty)
        try await eventually { list.waiting }
        list.release(200, #"{"alerts":[]}"#); try await eventually { model.sectionUpdated[.alerts] != nil }
    }
}

@MainActor private final class AlertCredentials: CredentialStorage {
    func load(_ server: String) throws -> Data? { try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "alert-test-token", expiresAt: "2030-01-01T00:00:00Z")) }
    func save(_ data: Data, server: String) throws {}
    func remove(_ server: String) {}
}
private final class AlertDefaults: UserDefaults, @unchecked Sendable {
    override func set(_ value: Any?, forKey key: String) {}
    override func string(forKey key: String) -> String? { nil }
}
private final class AlertRequests: @unchecked Sendable {
    private let lock = NSLock(); private var requests: [URLRequest] = []
    var all: [URLRequest] { lock.withLock { requests } }
    func append(_ request: URLRequest) { lock.withLock { requests.append(request) } }
    func clear() { lock.withLock { requests = [] } }
}
private final class AlertGate: @unchecked Sendable {
    private let lock = NSLock(); private var request: AlertProtocol?
    var waiting: Bool { lock.withLock { request != nil } }
    func hold(_ value: AlertProtocol) { lock.withLock { request = value } }
    private func take() -> AlertProtocol? { lock.withLock { let old = request; request = nil; return old } }
    func release(_ status: Int, _ body: String) { take()?.respond(status, body) }
    func releaseFixture() { take()?.fixture() }
}
private final class AlertProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (AlertProtocol) -> Void)?
    private let lock = NSLock(); private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(self) }
    override func stopLoading() { lock.withLock { stopped = true } }
    func respond(_ status: Int, _ body: String) {
        guard !lock.withLock({ stopped }) else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    func fixture() {
        if request.url?.path == "/api/mobile/session" && request.httpMethod != "DELETE" { respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#) }
        else if request.httpMethod == "POST" { respond(201, #"{"id":1}"#) }
        else if request.httpMethod == "DELETE" { respond(200, #"{"ok":true}"#) }
        else { respond(200, #"{"alerts":[]}"#) }
    }
    static func body(_ request: URLRequest) -> [String: Any]? {
        var data = request.httpBody
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var bytes = [UInt8](repeating: 0, count: 4096), contents = Data()
            while stream.hasBytesAvailable { let count = stream.read(&bytes, maxLength: bytes.count); if count <= 0 { break }; contents.append(contentsOf: bytes.prefix(count)) }
            data = contents
        }
        return data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
}
