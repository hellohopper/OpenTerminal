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
        await phone.signOut(); await browser.signOut()
    }
}
private struct Created: Decodable, Sendable { let id: Int }
private struct NewList: Encodable, Sendable { let name: String; let symbols: [String] }
private struct Replacement: Encodable, Sendable { let name: String; let symbols: [String]; let version: Int }
