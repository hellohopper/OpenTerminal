import Foundation
import Testing
import OpenTerminalCore
@testable import OpenTerminalAppModel

@Suite(.serialized) @MainActor struct StartupTests {
    private func fixture(defaults: UserDefaults? = nil, server: String = "https://fixture.example.com") throws -> (TerminalModel, MemoryCredentials) {
        let vault = MemoryCredentials()
        vault.data = try JSONEncoder().encode(MobileCredential(id: "phone", name: "Phone", token: "device-token", expiresAt: "2030-01-01T00:00:00Z"))
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ModelProtocol.self]
        // All preference and credential writes stay in memory.
        let preferences = defaults ?? MemoryDefaults(suiteName: "openterminal-test-\(UUID())")!
        let model = TerminalModel(defaults: preferences, credentials: vault) { TerminalAPI(server: $0, credential: $1, configuration: configuration) }
        model.serverText = server
        return (model, vault)
    }
    @Test func restoringAuthorizationDoesNotWaitForMarketRequests() async throws {
        ModelProtocol.handler = { request in
            #expect(request.request.url?.path == "/api/mobile/session")
            request.respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#)
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture()
        await model.restoreSession()
        #expect(model.signedIn); #expect(!model.restoring)
        #expect(model.sectionUpdated.isEmpty); #expect(model.lastUpdated == nil)
    }
    @Test func stalledWatchlistDoesNotBlockAccountsOrAlertsAndRetryClearsItsError() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/watchlists" { gate.hold(request) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession()
        let refresh = Task { await model.refresh() }
        await eventually { gate.isHeld && model.sectionUpdated[.alerts] != nil && model.sectionUpdated[.holdings] != nil }
        #expect(model.loadingSections.contains(.watchlist)); #expect(model.alerts.count == 1)
        gate.release(503, #"{"error":"Lists temporarily unavailable"}"#)
        await refresh.value
        #expect(model.sectionErrors[.watchlist] != nil); #expect(model.sectionErrors[.alerts] == nil)
        #expect(model.loadingSections.isEmpty); #expect(model.lastUpdated == nil)
        ModelProtocol.handler = { $0.respondFixture() }
        await model.refresh()
        #expect(model.sectionErrors.isEmpty); #expect(model.lastUpdated != nil); #expect(!model.reconnecting)
    }
    @Test func quoteFailureDoesNotHideSuccessfulBriefingOrOtherSections() async throws {
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/watchlists": request.respond(200, #"[{"id":1,"version":1,"payload":{"name":"Main","symbols":["AAPL"]}}]"#)
            case "/api/quotes": request.respond(502, #"{"error":"Quotes unavailable"}"#)
            case "/api/briefings/current": request.respond(200, #"{"date":"2026-10-24","summary":"Ready","indexes":[],"headlines":[],"warnings":[]}"#)
            default: request.respondFixture()
            }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession(); await model.refresh()
        #expect(model.briefing?.summary == "Ready"); #expect(model.sectionUpdated[.briefing] != nil)
        #expect(model.sectionErrors[.watchlist] != nil); #expect(model.sectionErrors[.briefing] == nil)
        #expect(model.alerts.count == 1)
    }
    @Test func signOutCancelsPendingRefreshAndClearsPrivateState() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/watchlists" { gate.hold(request) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (model, vault) = try fixture(); await model.restoreSession()
        let refresh = Task { await model.refresh() }
        await eventually { gate.isHeld && model.sectionUpdated[.alerts] != nil }
        await model.signOut(); gate.release(200, #"[{"id":1,"version":1,"payload":{"name":"Old","symbols":["IBM"]}}]"#)
        await refresh.value
        #expect(!model.signedIn); #expect(model.alerts.isEmpty); #expect(model.sharedLists.isEmpty)
        #expect(model.loadingSections.isEmpty); #expect(model.sectionUpdated.isEmpty); #expect(vault.data == nil)
    }
    @Test func togglingAlertRefreshesOnlyAlertRules() async throws {
        ModelProtocol.handler = { $0.respondFixture() }; defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession(); await model.refresh()
        let rule = try #require(model.alerts.first)
        ModelProtocol.handler = { request in
            #expect(["/api/alerts", "/api/alerts/1"].contains(request.request.url?.path ?? ""), "Alert actions must not wait for watchlists, portfolios or market providers")
            if request.request.httpMethod == "PUT" { request.respond(200, #"{"id":1}"#) }
            else { request.respondFixture() }
        }
        await model.setArmed(rule, session: model.sessionID)
        await eventually { model.sectionUpdated[.alerts] != nil }
        #expect(model.sectionErrors.isEmpty)
    }

    @Test func signOutClearsTheResearchSheetBeforeAnotherLogin() async throws {
        ModelProtocol.handler = { $0.respondFixture() }; defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession()
        model.researchSymbol = "AAPL"
        await model.signOut()
        #expect(model.researchSymbol == nil)
    }

    @Test func lateNotificationFailureCannotWriteIntoASignedOutSession() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/mobile/push" { gate.hold(request) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession()
        let registration = Task { await model.enableNotifications() }; await eventually { gate.isHeld }
        await model.signOut()
        gate.release(503, #"{"error":"Old registration failed"}"#); await registration.value
        #expect(!model.signedIn && model.pushMessage == nil)
    }

    @Test func phoneHealthReportsPartialFailuresAndBackupFailuresIndependently() async throws {
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/status": request.respond(200, #"{"ok":true,"database":"sqlite"}"#)
            case "/api/data/schedule": request.respond(200, #"{"policy":{"enabled":true},"status":{"lastSuccess":null,"error":"private diagnostic"}}"#)
            case "/api/mobile/push": request.respond(503, #"{"error":"Push status unavailable"}"#)
            default: request.respondFixture()
            }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession(); await model.checkHealth()
        #expect(model.health["Connection"]?.contains("Connected") == true)
        #expect(model.health["Backups"]?.contains("failed") == true)
        #expect(model.health["Native push"]?.contains("unavailable") == true)
        #expect(model.signedIn); #expect(!model.checkingHealth)
    }
    @Test func expiredAuthorizationClearsAllConcurrentSectionState() async throws {
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/alerts" { request.respond(401, #"{"error":"Revoked"}"#) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (model, vault) = try fixture(); await model.restoreSession(); await model.refresh()
        #expect(!model.signedIn); #expect(vault.data == nil); #expect(model.error != nil)
        #expect(model.sectionUpdated.isEmpty); #expect(model.sectionErrors.isEmpty); #expect(model.loadingSections.isEmpty)
    }
    @Test func deletingLastListClearsSelectionWithoutRecreatingDefaults() async throws {
        ModelProtocol.handler = { $0.respondFixture() }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession(); try await model.refreshLists()
        let row = try #require(model.sharedLists.first)
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/watchlists/1":
                #expect(request.request.httpMethod == "DELETE")
                #expect(URLComponents(url: request.request.url!, resolvingAgainstBaseURL: false)?.queryItems == [URLQueryItem(name: "version", value: "1")])
                request.respond(200, #"{"ok":true}"#)
            case "/api/watchlists": request.respond(200, "[]")
            case "/api/watchlists/default": request.respond(200, #"{"id":null}"#)
            default: request.respondFixture()
            }
        }
        let success = await model.deleteList(row)
        #expect(success); #expect(model.sharedListID == nil); #expect(model.watchlist.isEmpty); #expect(model.sharedLists.isEmpty)
        #expect(!model.managingLists); #expect(model.listManagementError == nil)
        await model.signOut()
    }
    @Test func staleRenameRefreshesLatestListWithoutStartingOfflineRecovery() async throws {
        ModelProtocol.handler = { $0.respondFixture() }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession(); try await model.refreshLists()
        let row = try #require(model.sharedLists.first)
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/watchlists/1/rename": request.respond(409, #"{"error":"This watchlist changed. Refresh and try again."}"#)
            case "/api/watchlists": request.respond(200, #"[{"id":1,"version":2,"payload":{"name":"Latest","symbols":["MSFT"]}}]"#)
            case "/api/quotes": request.respond(200, "[]")
            case "/api/briefings/current": request.respond(200, #"{"date":"2026-10-29","summary":"Ready","indexes":[],"headlines":[],"warnings":[]}"#)
            default: request.respondFixture()
            }
        }
        let success = await model.renameList(row, name: "Stale rename")
        #expect(!success); #expect(model.listManagementError?.contains("changed") == true)
        await eventually { model.sharedLists.first?.payload.name == "Latest" && !model.loadingSharedLists }
        #expect(model.sharedLists.first?.payload.name == "Latest"); #expect(model.watchlist == ["MSFT"])
        #expect(!model.reconnecting); #expect(!model.managingLists); #expect(model.signedIn)
        await model.signOut()
    }
    @Test func createdListBecomesSelectedAndLateMutationCannotRestoreSignedOutState() async throws {
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/watchlists" where request.request.httpMethod == "POST": request.respond(201, #"{"id":2}"#)
            case "/api/watchlists": request.respond(200, #"[{"id":1,"version":1,"payload":{"name":"Old","symbols":["IBM"]}},{"id":2,"version":1,"payload":{"name":"New","symbols":[]}}]"#)
            default: request.respondFixture()
            }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession()
        let success = await model.createList(name: "New")
        #expect(success); #expect(model.sharedListID == 2); #expect(model.watchlist.isEmpty)
        let gate = ResponseGate(), row = try #require(model.sharedLists.last)
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/watchlists/2" { gate.hold(request) }
            else { request.respondFixture() }
        }
        let pending = Task { await model.deleteList(row) }
        await eventually { gate.isHeld }
        await model.signOut(); gate.release(200, #"{"ok":true}"#)
        let deleted = await pending.value
        #expect(!deleted); #expect(!model.signedIn); #expect(model.sharedLists.isEmpty); #expect(model.sharedListID == nil)
        #expect(!model.managingLists); #expect(model.listManagementError == nil)
    }
    @Test func researchNotesAndChartLoadWhileQuoteIsStalledAndRetryIsSectionScoped() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/quotes": gate.hold(request)
            case "/api/history/AAPL": request.respond(200, #"[{"time":1,"close":12}]"#)
            case "/api/news": request.respond(200, "[]")
            case "/api/journal": request.respond(200, #"{"entries":[{"id":1,"symbol":"AAPL","title":"Private note","body":"Available"}]}"#)
            default: request.respondFixture()
            }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"), task = Task { await research.refresh() }
        await eventually { gate.isHeld && research.updated[.notes] != nil && research.updated[.chart] != nil }
        #expect(research.notes.first?.title == "Private note"); #expect(research.loading.contains(.quote)); #expect(research.errors[.notes] == nil)
        gate.release(503, #"{"error":"Quotes temporarily unavailable"}"#); await task.value
        #expect(research.errors[.quote] != nil); #expect(research.updated[.news] != nil)
        let notesTime = research.updated[.notes]
        ModelProtocol.handler = { request in
            #expect(request.request.url?.path == "/api/quotes")
            request.respond(200, "[]")
        }
        await research.load(.quote)
        #expect(research.errors[.quote] == nil); #expect(research.updated[.notes] == notesTime)
    }
    @Test func changingChartRangeRejectsAnOlderResponse() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/history/AAPL" {
                if request.request.url?.query?.contains("range=1M") == true { gate.hold(request) }
                else { request.respond(200, #"[{"time":2,"close":20}]"#) }
            } else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"); research.range = "1M"
        let old = Task { await research.load(.chart) }; await eventually { gate.isHeld }
        research.range = "1Y"; await research.load(.chart)
        gate.release(200, #"[{"time":1,"close":10}]"#); await old.value
        #expect(research.candles.map(\.close) == [20]); #expect(!research.loading.contains(.chart))
    }
    @Test func savingNotePreservesNewerDraftEvenWhenResearchIsReopened() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/journal" {
                if request.request.httpMethod == "POST" { gate.hold(request) }
                else { request.respond(200, #"{"entries":[]}"#) }
            } else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"); research.title = "Original"; research.bodyText = "First draft"
        let save = Task { await research.saveNote() }; await eventually { gate.isHeld }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL")
        #expect(reopened.bodyText == "First draft"); reopened.bodyText = "Newer edits"
        #expect(ResearchModel(terminal: terminal, symbol: "MSFT").bodyText.isEmpty)
        gate.release(201, #"{"id":1}"#); await save.value
        #expect(ResearchModel(terminal: terminal, symbol: "AAPL").bodyText == "Newer edits")
        #expect(research.message?.contains("Newer edits") == true)
        #expect(reopened.bodyText == "Newer edits")
        await eventually { research.updated[.notes] != nil && reopened.updated[.notes] != nil }
    }
    @Test func completedSaveClearsOnlySubmittedDraftAndSignOutClearsAllDrafts() async throws {
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/journal" { request.respond(200, request.request.httpMethod == "POST" ? #"{"id":1}"# : #"{"entries":[]}"#) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"); research.title = "Saved"; research.bodyText = "Body"; await research.saveNote()
        #expect(!research.hasDraft); #expect(terminal.researchDrafts.isEmpty)
        research.title = "Unsaved"; #expect(!terminal.researchDrafts.isEmpty)
        await terminal.signOut(); #expect(terminal.researchDrafts.isEmpty)
        research.bodyText = "Old view cannot restore a signed-out draft"; #expect(terminal.researchDrafts.isEmpty)
    }
    @Test func simplifiedChineseResourcesIncludeInterfaceAndConnectionFeedback() throws {
        let app = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("App")
        let chinese = try #require(Bundle(path: app.appendingPathComponent("zh-Hans.lproj").path))
        let english = try #require(Bundle(path: app.appendingPathComponent("en.lproj").path))
        #expect(chinese.localizedString(forKey: "Research notes", value: nil, table: nil) == "研究笔记")
        #expect(chinese.localizedString(forKey: "Note saved. Newer edits are kept as a draft.", value: nil, table: nil).contains("新输入"))
        #expect(chinese.localizedString(forKey: "Your session expired. Sign in again.", value: nil, table: nil) == "登录已过期，请重新登录。")
        #expect(english.localizedString(forKey: "Research notes", value: nil, table: nil) == "Research notes")
    }
    @Test func reopenedResearchSharesPendingSaveAndClearsTheSubmittedDraft() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/journal" {
                if request.request.httpMethod == "POST" { gate.hold(request) }
                else { request.respond(200, #"{"entries":[]}"#) }
            } else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let original = ResearchModel(terminal: terminal, symbol: "AAPL")
        original.title = "Saving note"; original.bodyText = "Same draft"
        let save = Task { await original.saveNote() }; await eventually { gate.isHeld }
        let reopened = ResearchModel(terminal: terminal, symbol: "AAPL")
        #expect(reopened.saving, "Reopened view should disable a second submission while the same draft saves")
        gate.release(201, #"{"id":1}"#); await save.value
        #expect(!reopened.hasDraft, "Successful unchanged draft should disappear from the reopened editor")
        await eventually { original.updated[.notes] != nil && reopened.updated[.notes] != nil }
    }
    @Test func switchingListsFetchesTheNewSelectionWhileAnOldRefreshIsPending() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            switch request.request.url?.path {
            case "/api/watchlists": request.respond(200, #"[{"id":1,"version":1,"payload":{"name":"First","symbols":["AAPL"]}},{"id":2,"version":1,"payload":{"name":"Second","symbols":["MSFT"]}}]"#)
            case "/api/quotes":
                if request.request.url?.query?.contains("AAPL") == true { gate.hold(request) }
                else { request.respond(200, #"[{"symbol":"MSFT","price":100,"source":"fixture"}]"#) }
            case "/api/briefings/current": request.respond(200, #"{"date":"2026-10-25","summary":"Ready","indexes":[],"headlines":[],"warnings":[]}"#)
            default: request.respondFixture()
            }
        }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(); await model.restoreSession()
        let refresh = Task { await model.refresh() }; await eventually { gate.isHeld }
        model.chooseList(2)
        try await Task.sleep(for: .milliseconds(100))
        #expect(model.quotes.first?.symbol == "MSFT", "New prices must load before the old response is released")
        gate.release(200, #"[{"symbol":"AAPL","price":50,"source":"fixture"}]"#); await refresh.value
        try await Task.sleep(for: .milliseconds(100))
        #expect(model.watchlist == ["MSFT"])
        #expect(model.quotes.first?.symbol == "MSFT", "Changing selection must fetch the new list without waiting another polling cycle")
    }
    @Test func restoresTheLastTabAccountAndChartRangeWithoutRestoringAccountData() async throws {
        ModelProtocol.handler = { $0.respondAccountsFixture() }
        defer { ModelProtocol.handler = nil }
        let defaults = MemoryDefaults(suiteName: "memory-only-view-choices")!
        let (first, _) = try fixture(defaults: defaults); await first.restoreSession(); await first.refresh()
        first.choosePortfolio(2); first.selectedTab = .holdings
        let research = ResearchModel(terminal: first, symbol: "AAPL"); research.range = "1Y"
        await eventually { first.sectionUpdated[.holdings] != nil && first.portfolioID == 2 }
        let (reopened, _) = try fixture(defaults: defaults); await reopened.restoreSession()
        #expect(reopened.selectedTab == .holdings); #expect(reopened.portfolioID == 2)
        #expect(reopened.positions.isEmpty && reopened.holdingQuotes.isEmpty && !reopened.holdingsReady)
        #expect(reopened.selectedPortfolio == nil)
        #expect(ResearchModel(terminal: reopened, symbol: "MSFT").range == "1Y")
        await reopened.refresh()
        #expect(reopened.selectedPortfolio?.name == "Long-term account")
        #expect(reopened.portfolioID == 2 && reopened.holdingsReady)
    }
    @Test func viewChoicesAreIsolatedByServerAndSurviveSigningOut() async throws {
        ModelProtocol.handler = { $0.respondAccountsFixture() }
        defer { ModelProtocol.handler = nil }
        let defaults = MemoryDefaults(suiteName: "memory-only-server-choices")!
        let (first, _) = try fixture(defaults: defaults); await first.restoreSession(); await first.refresh()
        first.choosePortfolio(2); first.selectedTab = .alerts
        let oldResearch = ResearchModel(terminal: first, symbol: "AAPL"); oldResearch.range = "5Y"
        await first.signOut(); oldResearch.range = "1M"
        #expect(first.selectedTab == .today && first.portfolioID == nil && first.preferredChartRange == "6M")
        let (other, _) = try fixture(defaults: defaults, server: "https://other.example.com"); await other.restoreSession()
        #expect(other.selectedTab == .today && other.portfolioID == nil && other.preferredChartRange == "6M")
        other.selectedTab = .watchlist; other.rememberChartRange("1M")
        let (reopened, _) = try fixture(defaults: defaults); await reopened.restoreSession()
        #expect(reopened.selectedTab == .alerts && reopened.portfolioID == 2 && reopened.preferredChartRange == "5Y")
    }
    @Test func invalidPreferencesAndDeletedAccountsFallBackToAvailableAccounts() async throws {
        let defaults = MemoryDefaults(suiteName: "memory-only-invalid-choices")!, prefix = "ios-view:https://fixture.example.com:"
        defaults.set("invalid-tab", forKey: prefix + "tab"); defaults.set("-1", forKey: prefix + "portfolio"); defaults.set("invalid-range", forKey: prefix + "range")
        ModelProtocol.handler = { $0.respondAccountsFixture() }
        defer { ModelProtocol.handler = nil }
        let (model, _) = try fixture(defaults: defaults); await model.restoreSession()
        #expect(model.selectedTab == .today && model.portfolioID == nil && model.preferredChartRange == "6M")
        await model.refresh(); model.choosePortfolio(2)
        await eventually { model.sectionUpdated[.holdings] != nil && model.portfolioID == 2 }
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/portfolios" { request.respond(200, #"[{"id":1,"name":"Trading account"}]"#) }
            else { request.respondAccountsFixture() }
        }
        await model.refresh()
        #expect(model.portfolioID == 1 && model.selectedPortfolio?.name == "Trading account")
        #expect(defaults.string(forKey: prefix + "portfolio") == "1")
        ModelProtocol.handler = { $0.respondFixture() }; await model.refresh()
        #expect(model.portfolioID == nil && model.selectedPortfolio == nil && model.positions.isEmpty)
        #expect(defaults.string(forKey: prefix + "portfolio") == nil)
        let (reopened, _) = try fixture(defaults: defaults); await reopened.restoreSession(); #expect(reopened.portfolioID == nil)
    }
    @Test func olderNotesKeepTheirCursorOnFailureAndRetryWithoutDuplicates() async throws {
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/journal" { request.respondNotesPage(ids: Array((11...60).reversed()), cursor: 11) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"); research.title = "Keep my draft"
        await research.load(.notes); #expect(research.notes.count == 50 && research.nextNoteCursor == 11)
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            #expect(request.request.url?.path == "/api/journal")
            let parameters = URLComponents(url: request.request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            #expect(parameters.contains(URLQueryItem(name: "before", value: "11")))
            gate.hold(request)
        }
        let more = Task { await research.loadMoreNotes() }; await eventually { gate.isHeld }
        await research.loadMoreNotes() // A second tap cannot start another request.
        gate.release(503, #"{"error":"Older notes unavailable"}"#); await more.value
        #expect(research.notes.count == 50 && research.nextNoteCursor == 11)
        #expect(research.notePageError != nil && !research.loadingMoreNotes)
        ModelProtocol.handler = { $0.respondNotesPage(ids: Array((1...11).reversed())) }
        await research.loadMoreNotes()
        #expect(research.notes.count == 60 && Set(research.notes.map(\.id)).count == 60)
        #expect(research.nextNoteCursor == nil && research.notePageError == nil)
        #expect(research.title == "Keep my draft")
    }
    @Test func searchingNotesRejectsEarlierSearchAndPaginationResponsesAndPreservesDrafts() async throws {
        let pageGate = ResponseGate(), searchGate = ResponseGate()
        ModelProtocol.handler = { request in
            guard request.request.url?.path == "/api/journal" else { request.respondFixture(); return }
            let parameters = URLComponents(url: request.request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let query = parameters.first { $0.name == "q" }?.value
            if parameters.contains(where: { $0.name == "before" }) { pageGate.hold(request) }
            else if query == "old" { searchGate.hold(request) }
            else if let query { #expect(query == "现金流 100%"); request.respondNotesPage(ids: [5]) }
            else { request.respondNotesPage(ids: [90], cursor: 90) }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"); research.title = "Draft survives searches"
        await research.load(.notes)
        let oldPage = Task { await research.loadMoreNotes() }; await eventually { pageGate.isHeld }
        research.noteSearch = "old"; let oldSearch = Task { await research.searchNotes() }; await eventually { searchGate.isHeld }
        research.noteSearch = "现金流 100%"; await research.searchNotes()
        #expect(research.notes.map(\.id) == [5] && research.notesQuery == "现金流 100%")
        searchGate.release(200, #"{"entries":[{"id":88,"symbol":"AAPL","title":"Old search","body":"Late"}],"nextCursor":88}"#)
        pageGate.release(200, #"{"entries":[{"id":89,"symbol":"AAPL","title":"Old page","body":"Late"}],"nextCursor":89}"#)
        await oldSearch.value; await oldPage.value
        #expect(research.notes.map(\.id) == [5] && research.nextNoteCursor == nil)
        #expect(!research.loadingMoreNotes && !research.loading.contains(.notes))
        await research.clearNotesSearch()
        #expect(research.notesQuery.isEmpty && research.noteSearch.isEmpty && research.notes.map(\.id) == [90])
        research.noteSearch = String(repeating: "x", count: 201); await research.searchNotes()
        #expect(research.noteSearchError != nil && research.notesQuery.isEmpty && research.notes.map(\.id) == [90])
        #expect(research.title == "Draft survives searches")
    }
    @Test func savingANoteReloadsTheActiveSearchAndInvalidatesAnOlderPageRequest() async throws {
        let gate = ResponseGate()
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/journal" {
                if request.request.url?.query?.contains("before=") == true { gate.hold(request) }
                else { request.respondNotesPage(ids: [2], cursor: 2) }
            } else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"); research.noteSearch = "cash"; await research.searchNotes()
        let oldPage = Task { await research.loadMoreNotes() }; await eventually { gate.isHeld }
        ModelProtocol.handler = { request in
            #expect(request.request.url?.path == "/api/journal")
            if request.request.httpMethod == "POST" { request.respond(201, #"{"id":3}"#) }
            else {
                let parameters = URLComponents(url: request.request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
                #expect(parameters.contains(URLQueryItem(name: "q", value: "cash")))
                #expect(!parameters.contains(where: { $0.name == "before" }))
                request.respondNotesPage(ids: [3, 2], cursor: 2)
            }
        }
        research.title = "cash update"; await research.saveNote()
        await eventually { research.notes.map(\.id) == [3, 2] }
        gate.release(200, #"{"entries":[{"id":1,"symbol":"AAPL","title":"Late page","body":"Old"}],"nextCursor":null}"#); await oldPage.value
        #expect(research.notes.map(\.id) == [3, 2] && research.nextNoteCursor == 2)
        #expect(research.notesQuery == "cash" && !research.hasDraft && !research.loadingMoreNotes)
    }
    @Test func searchingAgainstAnOlderBackendDoesNotPresentUnfilteredNotesAsMatches() async throws {
        ModelProtocol.handler = { request in
            if request.request.url?.path == "/api/journal" { request.respond(200, #"{"entries":[{"id":4,"symbol":"AAPL","title":"Unfiltered note","body":"Not a search result"}],"nextCursor":null}"#) }
            else { request.respondFixture() }
        }
        defer { ModelProtocol.handler = nil }
        let (terminal, _) = try fixture(); await terminal.restoreSession()
        let research = ResearchModel(terminal: terminal, symbol: "AAPL"); research.noteSearch = "cashflow"; await research.searchNotes()
        #expect(research.notes.isEmpty && research.errors[.notes]?.contains("Update the Mac") == true)
        await research.clearNotesSearch()
        #expect(research.notes.map(\.id) == [4] && research.errors[.notes] == nil)
    }
    private func eventually(_ condition: () -> Bool) async {
        for _ in 0..<300 { if condition() { return }; try? await Task.sleep(for: .milliseconds(10)) }
        #expect(condition(), "Independent sections should complete while another request is held")
    }
}
private final class MemoryDefaults: UserDefaults, @unchecked Sendable {
    private var values: [String: Any] = [:]
    override func set(_ value: Any?, forKey key: String) { values[key] = value }
    override func string(forKey key: String) -> String? { values[key] as? String }
    override func integer(forKey key: String) -> Int { values[key] as? Int ?? 0 }
    override func stringArray(forKey key: String) -> [String]? { values[key] as? [String] }
}
@MainActor private final class MemoryCredentials: CredentialStorage {
    var data: Data?
    func load(_ server: String) throws -> Data? { data }
    func save(_ data: Data, server: String) throws { self.data = data }
    func remove(_ server: String) { data = nil }
}
private final class ResponseGate: @unchecked Sendable {
    private let lock = NSLock()
    private var held: ModelProtocol?
    var isHeld: Bool { lock.withLock { held != nil } }
    func hold(_ request: ModelProtocol) { lock.withLock { held = request } }
    func release(_ status: Int, _ body: String) { let request = lock.withLock { let value = held; held = nil; return value }; request?.respond(status, body) }
}
private final class ModelProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (ModelProtocol) -> Void)?
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(self) }
    override func stopLoading() { lock.withLock { stopped = true } }
    func respond(_ status: Int, _ body: String) {
        guard !lock.withLock({ stopped }) else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["content-type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    func respondFixture() {
        switch request.url?.path {
        case "/api/mobile/session": respond(200, #"{"id":"phone","name":"Phone","expiresAt":"2030-01-01T00:00:00Z"}"#)
        case "/api/watchlists": respond(200, #"[{"id":1,"version":1,"payload":{"name":"Main","symbols":[]}}]"#)
        case "/api/portfolios": respond(200, "[]")
        case "/api/alerts": respond(200, #"{"alerts":[{"id":1,"symbol":"AAPL","condition":"PRICE_ABOVE","threshold":100,"label":"Test","armed":1,"revision":1,"generation":"g1"}]}"#)
        default: respond(404, #"{"error":"Unexpected fixture path"}"#)
        }
    }
    func respondAccountsFixture() {
        if request.url?.path == "/api/portfolios" { respond(200, #"[{"id":1,"name":"Trading account"},{"id":2,"name":"Long-term account"}]"#) }
        else if request.url?.path.hasSuffix("/positions") == true { respond(200, "[]") }
        else { respondFixture() }
    }
    func respondNotesPage(ids: [Int], cursor: Int? = nil) {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value ?? ""
        var page: [String: Any] = ["entries": ids.map { ["id": $0, "symbol": "AAPL", "title": "Note \($0)", "body": "Evidence"] }, "query": query]
        if let cursor { page["nextCursor"] = cursor } else { page["nextCursor"] = NSNull() }
        let data = try! JSONSerialization.data(withJSONObject: page)
        respond(200, String(decoding: data, as: UTF8.self))
    }
}
