import Foundation
import Testing
import OpenTerminalCore

// Only the harness supplies these values; ordinary `swift test` never contacts a backend.
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["TERMINAL_INTEGRATION_ORIGIN"] != nil))
struct BackendIntegrationTests {
    private func connection() throws -> (ServerConnection, String) {
        let env = ProcessInfo.processInfo.environment
        let origin = try #require(env["TERMINAL_INTEGRATION_ORIGIN"])
        let password = try #require(env["TERMINAL_INTEGRATION_PASSWORD"])
        let server = try ServerConnection(origin)
        #expect(server.origin.scheme == "http")
        guard server.origin.host == "127.0.0.1", let port = server.origin.port, port > 1024 else {
            throw ConnectionError.invalidServer
        }
        return (server, password)
    }
    private func paired(_ name: String) async throws -> (TerminalAPI, MobileCredential) {
        let (server, password) = try connection()
        let api = TerminalAPI(server: server)
        return (api, try await api.pair(password: password, name: name))
    }
    private func status(_ error: Error, _ code: Int) {
        if case .response(let received, _) = error as? ConnectionError { #expect(received == code) }
        else { Issue.record("Expected HTTP \(code), received \(error)") }
    }

    @Test func triggerHistoryPaginatesSnapshotsAndSurvivesRuleDeletion() async throws {
        let (phone, _) = try await paired("History reader")
        let (server, password) = try connection(), browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        struct Input: Encodable, Sendable {
            let symbol = "AAPL", armed = true
            let condition: String, threshold: Double, label: String, metric: String
        }
        struct Check: Decodable, Sendable { let triggered: Int; let deferred: Bool }
        var ids = Set<Int>()
        for index in 0..<55 {
            let input = Input(condition: index == 53 ? "CHANGE_ABOVE" : "PRICE_ABOVE", threshold: index == 53 ? 0.5 : 1,
                              label: "Native history \(index)", metric: index == 54 ? "volume" : "native")
            // Populate through the browser session, as native history also includes web
            // rules. Keep bulk setup/cleanup below the phone-verification rate budget.
            let created: Created = try await browser.post("/api/alerts", body: input)
            ids.insert(created.id)
        }
        // The background monitor may have checked partway through creation. Respect its
        // cooldown and wait for all fixture rules rather than assuming a single check.
        var rules: [AlertRule] = []
        for _ in 0..<100 {
            let _: Check = try await browser.post("/api/alerts/check", body: [String: String]())
            let list: AlertList = try await browser.get("/api/alerts")
            rules = list.alerts.filter { ids.contains($0.id) }
            if rules.count == ids.count && rules.allSatisfy({ $0.armed == 0 }) { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        try #require(rules.count == 55 && rules.allSatisfy { $0.armed == 0 }, "Fixture triggers were not recorded")
        let status: AlertList = try await phone.get("/api/alerts")
        let monitor = try #require(status.monitor)
        #expect(monitor.running == true && monitor.intervalSeconds == 15 && monitor.lastAttempt != nil && monitor.lastError == nil && monitor.missingSymbols == [])
        #expect(rules.allSatisfy { $0.lastEvaluation != nil && $0.lastTrigger != nil && $0.last_value != nil && $0.last_checked_at == $0.last_triggered_at })
        let first: AlertHistoryPage = try await phone.get("/api/alerts/history")
        #expect(first.events.count == 50)
        let cursor = try #require(first.nextCursor)
        #expect(cursor == first.events.last?.id)
        let second: AlertHistoryPage = try await phone.get("/api/alerts/history", query: ["before": String(cursor)])
        #expect(second.events.count == 5 && second.nextCursor == nil)
        let events = first.events + second.events
        #expect(Set(events.map(\.id)).count == 55 && events.map(\.id) == events.map(\.id).sorted(by: >))
        #expect(Set(events.compactMap(\.alert_id)) == ids)
        #expect(events.allSatisfy { $0.symbol == "AAPL" && $0.label.hasPrefix("Native history ") && $0.recordedAt != nil && !$0.source.isEmpty && $0.price > 0 && $0.currency == "USD" })
        let volume = try #require(events.first { $0.metric == "volume" })
        let change = try #require(events.first { $0.condition == "CHANGE_ABOVE" })
        #expect(volume.valueKind == .volume && volume.value == 100000 && volume.price == 110)
        #expect(change.valueKind == .dailyChange && change.value == 1 && change.price == 110 && change.threshold == 0.5)
        #expect(events.filter { $0.valueKind == .price }.allSatisfy { $0.value == $0.price && $0.threshold == 1 })
        let original = try #require(first.events.first), ruleID = try #require(original.alert_id)
        let rule = try #require(rules.first { $0.id == ruleID }), version = try #require(rule.mutationQuery)
        #expect(rule.last_value == original.value)
        // A reviewed pause clears current evaluation fields but keeps the past trigger.
        try await phone.setAlertArmed(id: ruleID, armed: false, query: version)
        let pausedList: AlertList = try await phone.get("/api/alerts")
        let paused = try #require(pausedList.alerts.first { $0.id == ruleID })
        #expect(paused == rule.settingArmed(false) && paused.last_checked_at == nil && paused.last_value == nil && paused.last_triggered_at == rule.last_triggered_at)
        let pausedVersion = try #require(paused.mutationQuery)
        try await phone.delete("/api/alerts/\(ruleID)", query: pausedVersion)
        let after: AlertHistoryPage = try await phone.get("/api/alerts/history")
        let retained = try #require(after.events.first { $0.id == original.id })
        #expect(retained.alert_id == nil && retained.label == original.label && retained.threshold == original.threshold && retained.value == original.value && retained.created_at == original.created_at)
        for row in rules where row.id != ruleID { try await browser.delete("/api/alerts/\(row.id)", query: try #require(row.mutationQuery)) }
        await phone.signOut(); await browser.signOut()
    }

    @Test func pairingRenewalRevocationAndOriginProtection() async throws {
        let (server, password) = try connection()
        let unauthenticated = TerminalAPI(server: server)
        do {
            let _: [Portfolio] = try await unauthenticated.get("/api/portfolios")
            Issue.record("Private API accepted an unauthenticated read")
        } catch { #expect(error as? ConnectionError == .unauthorized) }
        do {
            _ = try await unauthenticated.pair(password: "wrong fixture password", name: "Rejected phone")
            Issue.record("Pairing accepted an incorrect password")
        } catch { status(error, 401) }

        let (phone, credential) = try await paired("Integration phone")
        let restored = TerminalAPI(server: server, credential: credential)
        let authorization = try await restored.renewDevice()
        #expect(authorization.id == credential.id)
        #expect(authorization.name == "Integration phone")
        let _: [Portfolio] = try await restored.get("/api/portfolios")

        var request = URLRequest(url: try server.url(path: "/api/watchlists"))
        request.httpMethod = "POST"
        request.httpBody = Data(#"{"name":"Forbidden","symbols":[]}"#.utf8)
        request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "Authorization")
        request.setValue("https://outside.invalid", forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let (_, response) = try await session.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 403)

        // A second native client must observe revocation immediately, even with a saved token.
        await phone.signOut()
        do {
            let _: [Portfolio] = try await restored.get("/api/portfolios")
            Issue.record("A revoked phone retained API access")
        } catch { #expect(error as? ConnectionError == .unauthorized) }
        do {
            _ = try await restored.renewDevice()
            Issue.record("A revoked phone renewed its authorization")
        } catch { #expect(error as? ConnectionError == .unauthorized) }
        // Browser cookie authentication uses the same owner configuration through the web proxy.
        let browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        let _: [Portfolio] = try await browser.get("/api/portfolios")
        await browser.signOut()
    }

    @Test func deviceManagementRevokesOnlyTheChosenDeviceAndCanRevokeItself() async throws {
        let (manager, owner) = try await paired("Device manager")
        let (target, victim) = try await paired("Device to revoke")
        let (other, untouched) = try await paired("Unaffected device")
        let before: [MobileDeviceInfo] = try await manager.get("/api/mobile/devices")
        #expect(before.contains { $0.id == owner.id && $0.revoked_at == nil })
        #expect(before.contains { $0.id == victim.id && $0.revoked_at == nil })
        try await manager.delete("/api/mobile/devices/\(victim.id)")
        let after: [MobileDeviceInfo] = try await manager.get("/api/mobile/devices")
        #expect(after.first { $0.id == victim.id }?.revoked_at != nil)
        #expect(after.first { $0.id == owner.id }?.revoked_at == nil)
        #expect(after.first { $0.id == untouched.id }?.revoked_at == nil)
        do {
            let _: [Portfolio] = try await target.get("/api/portfolios")
            Issue.record("Revoked device retained access")
        } catch { #expect(error as? ConnectionError == .unauthorized) }
        do {
            _ = try await target.renewDevice()
            Issue.record("Revoked device renewed its authorization")
        } catch { #expect(error as? ConnectionError == .unauthorized) }
        let _: [Portfolio] = try await other.get("/api/portfolios")
        _ = try await manager.renewDevice()
        try await manager.delete("/api/mobile/devices/\(owner.id)")
        do {
            let _: [Portfolio] = try await manager.get("/api/portfolios")
            Issue.record("Self-revoked device retained access")
        } catch { #expect(error as? ConnectionError == .unauthorized) }
        let remaining: [MobileDeviceInfo] = try await other.get("/api/mobile/devices")
        #expect(remaining.first { $0.id == owner.id }?.revoked_at != nil)
        #expect(remaining.first { $0.id == untouched.id }?.revoked_at == nil)
        await manager.signOut(); await target.signOut(); await other.signOut()
    }

    @Test func sharedWatchlistsRejectStaleWritesAndKeepExplicitDeletion() async throws {
        let (phone, _) = try await paired("Watchlist phone")
        let (server, password) = try connection(), browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        let created: Created = try await phone.post("/api/watchlists", body: NewList(name: "Shared 中文", symbols: ["AAPL"]))
        let rows: [SharedWatchlist] = try await browser.get("/api/watchlists")
        let original = try #require(rows.first { $0.id == created.id })
        let _: SharedWatchlist = try await browser.post("/api/watchlists/\(created.id)/symbols", body: ["symbol": "MSFT", "action": "add"])
        let updated: SharedWatchlist = try await phone.post("/api/watchlists/\(created.id)/symbols", body: ["symbol": "SPY", "action": "add"])
        #expect(Set(updated.payload.symbols) == Set(["AAPL", "MSFT", "SPY"]))
        do {
            let _: Acknowledgement = try await phone.put("/api/watchlists/\(created.id)", body: Replacement(name: "Stale", symbols: ["NVDA"], version: original.version))
            Issue.record("A stale replacement overwrote shared symbols")
        } catch { status(error, 409) }
        let saved: [SharedWatchlist] = try await browser.get("/api/watchlists")
        #expect(saved.first { $0.id == created.id }?.payload.symbols == updated.payload.symbols)
        try await phone.delete("/api/watchlists/\(created.id)", query: ["version": String(updated.version)])
        let _: Acknowledgement = try await phone.post("/api/watchlists/default", body: NewList(name: "Must stay empty", symbols: ["AAPL"]))
        let empty: [SharedWatchlist] = try await browser.get("/api/watchlists")
        #expect(empty.isEmpty)
        await phone.signOut(); await browser.signOut()
    }

    @Test func publishedLayoutImportChangesOnlyTheReviewedSharedList() async throws {
        let (phone, _) = try await paired("Layout import phone")
        let (server, password) = try connection(), browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        let oldHead: SyncHead? = try await browser.get("/api/sync")
        let _: Acknowledgement = try await browser.post("/api/sync", body: SyncUpload(baseVersion: oldHead?.version))
        let savedHead: SyncHead = try await phone.get("/api/sync")
        let snapshot: SyncSnapshot = try await phone.get("/api/sync")
        let source = try #require(snapshot.payload.workspace.workspaces.first { $0.id == "published-full" })
        let empty = try #require(snapshot.payload.workspace.workspaces.first { $0.id == "published-empty" })
        #expect(source.watchlist == ["MSFT", "SPY"] && empty.watchlist.isEmpty)
        let target: Created = try await phone.post("/api/watchlists", body: NewList(name: "Target one", symbols: ["AAPL"]))
        let other: Created = try await phone.post("/api/watchlists", body: NewList(name: "Target two", symbols: ["TSLA"]))
        let initial: [SharedWatchlist] = try await phone.get("/api/watchlists")
        let reviewed = try #require(initial.first { $0.id == target.id })
        let newer: SharedWatchlist = try await browser.post("/api/watchlists/\(target.id)/symbols", body: ["symbol": "GOOG", "action": "add"])
        do {
            let _: Acknowledgement = try await phone.put("/api/watchlists/\(target.id)", body: Replacement(name: reviewed.payload.name, symbols: source.watchlist, version: reviewed.version))
            Issue.record("A stale import overwrote newer shared symbols")
        } catch { status(error, 409) }
        let conflicted: [SharedWatchlist] = try await browser.get("/api/watchlists")
        #expect(conflicted.first { $0.id == target.id }?.payload.symbols == ["AAPL", "GOOG"])
        let _: Acknowledgement = try await phone.put("/api/watchlists/\(target.id)", body: Replacement(name: newer.payload.name, symbols: source.watchlist, version: newer.version))
        let imported: [SharedWatchlist] = try await browser.get("/api/watchlists")
        let current = try #require(imported.first { $0.id == target.id })
        #expect(current.payload.name == "Target one" && current.payload.symbols == source.watchlist)
        #expect(imported.first { $0.id == other.id }?.payload.symbols == ["TSLA"])
        let _: Acknowledgement = try await phone.put("/api/watchlists/\(target.id)", body: Replacement(name: current.payload.name, symbols: empty.watchlist, version: current.version))
        let cleared: [SharedWatchlist] = try await phone.get("/api/watchlists")
        let clearedTarget = try #require(cleared.first { $0.id == target.id })
        #expect(clearedTarget.payload.symbols.isEmpty && cleared.first { $0.id == other.id }?.payload.symbols == ["TSLA"])
        let untouchedHead: SyncHead = try await browser.get("/api/sync")
        let untouched: SyncSnapshot = try await browser.get("/api/sync")
        #expect(untouchedHead.version == savedHead.version && untouched.payload.workspace.workspaces == snapshot.payload.workspace.workspaces)
        try await phone.delete("/api/watchlists/\(target.id)", query: ["version": String(clearedTarget.version)])
        let otherRow = try #require(cleared.first { $0.id == other.id })
        try await phone.delete("/api/watchlists/\(other.id)", query: ["version": String(otherRow.version)])
        await phone.signOut(); await browser.signOut()
    }

    @Test func nativePriceAlertCreationPauseAndDeletionMatchTheBackendContract() async throws {
        let (phone, _) = try await paired("Alert contract phone")
        let created: Created = try await phone.post("/api/alerts", body: AlertInput(symbol: "AAPL", condition: "PRICE_ABOVE", threshold: 1000, label: "原生提醒"))
        let before: AlertList = try await phone.get("/api/alerts")
        let rule = try #require(before.alerts.first { $0.id == created.id })
        #expect(rule.symbol == "AAPL" && rule.threshold == 1000 && rule.label == "原生提醒" && rule.armed == 1)
        try await phone.setAlertArmed(id: created.id, armed: false)
        let after: AlertList = try await phone.get("/api/alerts")
        #expect(after.alerts.first { $0.id == created.id }?.armed == 0)
        // The actual delete route returns 204 with no JSON acknowledgement.
        try await phone.delete("/api/alerts/\(created.id)")
        let deleted: AlertList = try await phone.get("/api/alerts")
        #expect(!deleted.alerts.contains { $0.id == created.id })
        await phone.signOut()
    }

    @Test func localizedThresholdsReachTheBackendAsNumericPrices() async throws {
        let (phone, _) = try await paired("Localized alert phone")
        for (identifier, text) in [("en_US", "1000.5"), ("de_DE", "1000,5"), ("ar_EG", "١٠٠٠٫٥")] {
            let threshold = try #require(PriceInput.parse(text, locale: Locale(identifier: identifier)))
            let created: Created = try await phone.post("/api/alerts", body: AlertInput(symbol: "AAPL", condition: "PRICE_ABOVE", threshold: threshold, label: "Localized \(identifier)"))
            let list: AlertList = try await phone.get("/api/alerts")
            let row = try #require(list.alerts.first { $0.id == created.id })
            #expect(row.threshold == 1000.5 && row.armed == 1)
            let version = try #require(row.mutationQuery)
            try await phone.delete("/api/alerts/\(created.id)", query: version)
        }
        await phone.signOut()
    }

    @Test func nativeAlertTypesRoundTripWithoutChangingTheirUnits() async throws {
        let (phone, _) = try await paired("All alert types")
        let (server, password) = try connection(), browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        // Non-triggering thresholds keep this contract independent of the monitor timer.
        let cases: [(AlertTrigger, String, String, Double)] = [
            (.priceAbove, "en_US", "2000.5", 2000.5), (.priceBelow, "fr_FR", "0,5", 0.5),
            (.dailyRise, "ar_EG", "٩٩٫٥", 99.5), (.dailyFall, "de_DE", "-99,5", -99.5),
            (.volumeAbove, "en_US", "1000000", 1000000), (.volumeBelow, "fr_FR", "1,5", 1.5)
        ]
        var createdRules: [(Int, AlertTrigger, Double)] = []
        for (type, identifier, text, expected) in cases {
            let value = try #require(type.parseThreshold(text, locale: Locale(identifier: identifier)))
            let created: Created = try await phone.post("/api/alerts", body: AlertInput(symbol: "AAPL", trigger: type, threshold: value, label: "Native \(type.rawValue)"))
            createdRules.append((created.id, type, expected))
        }
        let result: AlertList = try await phone.get("/api/alerts")
        for (id, type, threshold) in createdRules {
            let rule = try #require(result.alerts.first { $0.id == id })
            #expect(rule.metric == type.metric && rule.condition == type.condition && rule.threshold == threshold && rule.armed == 1)
            #expect(rule.conditionLabelKey == type.labelKey)
            let version = try #require(rule.mutationQuery)
            try await browser.delete("/api/alerts/\(id)", query: version)
        }
        await phone.signOut(); await browser.signOut()
    }

    @Test func conditionalAlertActionsProtectRulesChangedOnAnotherDevice() async throws {
        let (phone, _) = try await paired("Versioned alert phone")
        let (server, password) = try connection(), browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        let created: Created = try await phone.post("/api/alerts", body: AlertInput(symbol: "AAPL", condition: "PRICE_ABOVE", threshold: 1000, label: "Original"))
        let before: AlertList = try await phone.get("/api/alerts")
        let original = try #require(before.alerts.first { $0.id == created.id })
        let oldVersion = try #require(original.mutationQuery)
        let _: Acknowledgement = try await browser.put("/api/alerts/\(created.id)", body: AlertEdit())
        do {
            try await phone.setAlertArmed(id: created.id, armed: false, query: oldVersion)
            Issue.record("An old phone view paused the browser's updated alert")
        } catch { status(error, 409) }
        do {
            try await phone.delete("/api/alerts/\(created.id)", query: oldVersion)
            Issue.record("An old phone confirmation deleted the browser's updated alert")
        } catch { status(error, 409) }
        let changed: AlertList = try await phone.get("/api/alerts")
        let current = try #require(changed.alerts.first { $0.id == created.id })
        #expect(current.threshold == 1200 && current.label == "Web changed" && current.armed == 1)
        let version = try #require(current.mutationQuery)
        var restored = version; restored["generation"] = "an-older-backup-generation"
        do {
            try await phone.setAlertArmed(id: created.id, armed: false, query: restored)
            Issue.record("An old alert generation changed the current alert")
        } catch { status(error, 409) }
        do {
            try await phone.delete("/api/alerts/\(created.id)", query: restored)
            Issue.record("An old alert generation deleted the current alert")
        } catch { status(error, 409) }
        do {
            try await phone.delete("/api/alerts/\(created.id)", query: ["revision": "1"])
            Issue.record("A partial alert version was accepted")
        } catch { status(error, 400) }
        try await phone.setAlertArmed(id: created.id, armed: false, query: version)
        let pausedList: AlertList = try await phone.get("/api/alerts")
        let paused = try #require(pausedList.alerts.first { $0.id == created.id })
        #expect(paused == current.settingArmed(false))
        let pausedVersion = try #require(paused.mutationQuery)
        try await phone.setAlertArmed(id: created.id, armed: true, query: pausedVersion)
        let rearmedList: AlertList = try await phone.get("/api/alerts")
        let rearmed = try #require(rearmedList.alerts.first { $0.id == created.id })
        #expect(rearmed == paused.settingArmed(true))
        let reviewed = try #require(rearmed.mutationQuery)
        try await phone.delete("/api/alerts/\(created.id)", query: reviewed)
        try await phone.delete("/api/alerts/\(created.id)", query: reviewed)
        let deleted: AlertList = try await browser.get("/api/alerts")
        #expect(!deleted.alerts.contains { $0.id == created.id })
        await phone.signOut(); await browser.signOut()
    }

    @Test func conditionalNoteDeletionProtectsEditsFromAnotherDevice() async throws {
        let (phone, _) = try await paired("Conditional note deletion phone")
        let (server, password) = try connection(), browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        let created: Created = try await phone.post("/api/journal", body: NoteInput(symbol: "MSFT", title: "Original note", body: "Original evidence"))
        let original: JournalEntry = try await phone.get("/api/journal/\(created.id)")
        let version = try #require(original.version)
        let _: Acknowledgement = try await browser.put("/api/journal/\(created.id)", body: NoteUpdate(version: version))
        do {
            try await phone.delete("/api/journal/\(created.id)", query: ["version": version])
            Issue.record("Stale phone confirmation deleted a newer web edit")
        } catch { status(error, 409) }
        for invalid in ["", String(repeating: "x", count: 101)] {
            do {
                try await phone.delete("/api/journal/\(created.id)", query: ["version": invalid])
                Issue.record("An invalid delete version was accepted")
            } catch { status(error, 400) }
        }
        let current: JournalEntry = try await phone.get("/api/journal/\(created.id)")
        #expect(current.body == "New evidence from another device" && current.version != version)
        let latest = try #require(current.version)
        try await phone.delete("/api/journal/\(created.id)", query: ["version": latest])
        // Retrying an acknowledged delete is harmless even when its response was lost.
        try await phone.delete("/api/journal/\(created.id)", query: ["version": latest])
        do {
            let _: JournalEntry = try await browser.get("/api/journal/\(created.id)")
            Issue.record("A confirmed deletion remained visible to the browser")
        } catch { status(error, 404) }
        await phone.signOut(); await browser.signOut()
    }

    @Test func researchNotesSearchOlderPagesAndKeepLiteralQueryCharacters() async throws {
        let (phone, _) = try await paired("Research phone")
        let (server, password) = try connection(), browser = TerminalAPI(server: server)
        try await browser.signIn(password: password)
        let title = "现金流 +20% C++ _literal_"
        let older: Created = try await phone.post("/api/journal", body: NoteInput(symbol: "AAPL", title: title, body: "Older phone note visible from the web"))
        for index in 0..<50 {
            let _: Acknowledgement = try await browser.post("/api/journal", body: NoteInput(symbol: "AAPL", title: "Newer note \(index)", body: "Page filler"))
        }
        let query = ["symbol": "AAPL", "kind": "research"]
        let first: JournalList = try await phone.get("/api/journal", query: query)
        #expect(first.entries.count == 50)
        #expect(!first.entries.contains { $0.id == older.id })
        let cursor = try #require(first.nextCursor)
        let second: JournalList = try await phone.get("/api/journal", query: query.merging(["before": String(cursor)]) { _, new in new })
        #expect(second.entries.map(\.id) == [older.id])
        #expect(second.nextCursor == nil)
        let search: JournalList = try await phone.get("/api/journal", query: query.merging(["q": title]) { _, new in new })
        #expect(search.query == title)
        #expect(search.entries.map(\.id) == [older.id])
        let seenOnWeb: JournalEntry = try await browser.get("/api/journal/\(older.id)")
        #expect(seenOnWeb.title == title)
        #expect(seenOnWeb.body == "Older phone note visible from the web")
        try await phone.delete("/api/journal/\(older.id)")
        let deleted: JournalList = try await phone.get("/api/journal", query: query.merging(["q": title]) { _, new in new })
        #expect(deleted.entries.isEmpty)
        do {
            let _: JournalEntry = try await browser.get("/api/journal/\(older.id)")
            Issue.record("Deleted research note remained visible on the web")
        } catch { status(error, 404) }
        await phone.signOut(); await browser.signOut()
    }
}
private struct Created: Decodable, Sendable { let id: Int }
private struct NewList: Encodable, Sendable { let name: String; let symbols: [String] }
private struct Replacement: Encodable, Sendable { let name: String; let symbols: [String]; let version: Int }
private struct NoteUpdate: Encodable, Sendable {
    let symbol = "MSFT", title = "Updated note", body = "New evidence from another device", kind = "research"
    let version: String
}
private struct AlertEdit: Encodable, Sendable { let threshold: Double = 1200; let label = "Web changed" }
private struct SyncHead: Decodable, Sendable { let version: String }
private struct SyncUpload: Encodable, Sendable {
    let baseVersion: String?
    private enum CodingKeys: String, CodingKey { case payload, baseVersion }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(PublishedPayload(), forKey: .payload)
        if let baseVersion { try container.encode(baseVersion, forKey: .baseVersion) }
        else { try container.encodeNil(forKey: .baseVersion) }
    }
}
private struct PublishedPayload: Encodable, Sendable {
    let format = "openterminal-device", version = 1
    let workspace = PublishedWorkspace(), preferences = PublishedPreferences(), drawings: [String: String] = [:]
}
private struct PublishedWorkspace: Encodable, Sendable {
    let activeWorkspaceId = "published-full"
    let workspaces = [PublishedLayout(id: "published-full", name: "Published full", watchlist: ["MSFT", "SPY"]), PublishedLayout(id: "published-empty", name: "Published empty", watchlist: [])]
}
private struct PublishedLayout: Encodable, Sendable {
    let id: String, name: String, watchlist: [String]
    let activeSymbol = "MSFT", widgets: [String] = [], layout: [String] = []
}
private struct PublishedPreferences: Encodable, Sendable { let groups: [String] = [], screeners: [String] = [] }
