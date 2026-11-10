import Foundation
import Testing
@testable import OpenTerminalCore

struct ResearchCaptureTests {
    @Test func capturesAndDraftsSurviveReloadAndStayScopedToTheirServer() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ResearchCaptureStore(root: root), first = "https://first.example.com", second = "https://second.example.com"
        let a = ResearchCapture(title: "A", text: "Offline evidence", origin: first), b = ResearchCapture(title: "B", origin: second), shared = ResearchCapture(title: "Shared")
        try store.save(a); try store.save(b); try store.save(shared)
        try store.saveDraft(.init(title: "AAPL", body: "Draft"), origin: first, symbol: "AAPL")
        try store.saveDraft(.init(title: "MSFT", body: "Different"), origin: second, symbol: "MSFT")
        let reopened = ResearchCaptureStore(root: root)
        #expect(try reopened.captures().count == 3)
        #expect(try reopened.draft(origin: first, symbol: "AAPL")?.body == "Draft")
        #expect(try reopened.draft(origin: second, symbol: "AAPL") == nil)
        try reopened.clear(origin: first)
        #expect(try reopened.captures().map(\.id).contains(a.id) == false)
        #expect(try reopened.captures().count == 2)
        #expect(try reopened.draft(origin: second, symbol: "MSFT")?.body == "Different")
    }
    @Test func retriesKeepTheSameUploadIdentityAndDoNotExposeLocalScope() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ResearchCaptureStore(root: root)
        var capture = ResearchCapture(title: "Shared screenshot", url: "https://example.com/report")
        try store.save(capture); capture.origin = "https://first.example.com"; try store.save(capture)
        let loaded = try #require(store.captures().first)
        #expect(loaded.id == capture.id)
        let payload = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(loaded.upload)) as? [String: Any])
        #expect(payload["clientId"] as? String == capture.id.uuidString.lowercased())
        #expect(payload["origin"] == nil && payload["createdAt"] == nil)
    }
    @Test func invalidAndOversizedCapturesNeverOverwriteSavedFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ResearchCaptureStore(root: root), original = ResearchCapture(title: "Keep this")
        try store.save(original)
        var invalid = original; invalid.url = "javascript:alert(1)"
        #expect(throws: (any Error).self) { try store.save(invalid) }
        invalid = original; invalid.text = String(repeating: "x", count: 17001)
        #expect(throws: (any Error).self) { try store.save(invalid) }
        #expect(try store.captures() == [original])
        #expect(throws: (any Error).self) { try store.saveDraft(.init(title: "Title"), origin: "https://example.com", symbol: "../../escape") }
    }
    @Test func unreadableLocalDataIsKeptAndReported() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ResearchCaptureStore(root: root), capture = ResearchCapture(title: "Saved")
        try store.save(capture)
        let path = root.appendingPathComponent("captures/\(capture.id.uuidString.lowercased()).json")
        try Data("not json".utf8).write(to: path)
        #expect(throws: (any Error).self) { try store.captures() }
        #expect(FileManager.default.fileExists(atPath: path.path))
    }
}
