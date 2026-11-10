import Foundation
import CryptoKit

public struct ResearchCapture: Codable, Equatable, Identifiable, Sendable {
    public var clientId: UUID
    public var title: String
    public var text: String
    public var url: String
    public var symbol: String?
    public var image: String?
    public var origin: String?
    public var createdAt: Date
    public var id: UUID { clientId }
    public init(clientId: UUID = UUID(), title: String, text: String = "", url: String = "", symbol: String? = nil, image: String? = nil, origin: String? = nil, createdAt: Date = .now) {
        self.clientId = clientId; self.title = title; self.text = text; self.url = url; self.symbol = symbol; self.image = image; self.origin = origin; self.createdAt = createdAt
    }
    public func validate() throws {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.utf16.count <= 120, text.utf16.count <= 17000,
              url.utf16.count <= 2000, url.isEmpty || ["http", "https"].contains(URL(string: url)?.scheme?.lowercased() ?? ""),
              image == nil || image!.utf8.count <= 1_400_000,
              symbol == nil || symbol!.range(of: "^[A-Z0-9.^=&-]{1,20}$", options: .regularExpression) != nil else { throw ResearchStorageError.invalidCapture }
        if let image {
            let parts = image.split(separator: ",", maxSplits: 1)
            guard parts.count == 2, ["data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"].contains(String(parts[0])),
                  let bytes = Data(base64Encoded: String(parts[1])), bytes.count <= 1_048_576 else { throw ResearchStorageError.invalidCapture }
        }
        if let origin { _ = try ServerConnection(origin) }
    }
    public var upload: ResearchCaptureUpload { ResearchCaptureUpload(clientId: clientId.uuidString.lowercased(), title: title, text: text, url: url, symbol: symbol, image: image) }
}
public struct ResearchCaptureUpload: Encodable, Sendable {
    public let clientId: String; public let title: String; public let text: String; public let url: String; public let symbol: String?; public let image: String?
}
public struct StoredResearchDraft: Codable, Equatable, Sendable {
    public var title: String; public var body: String
    public init(title: String = "", body: String = "") { self.title = title; self.body = body }
}
public enum ResearchStorageError: LocalizedError {
    case unavailable, invalidCapture, full, corrupt
    public var errorDescription: String? {
        let text = switch self {
        case .unavailable: "Research storage is unavailable. Check the app group signing configuration."
        case .invalidCapture: "Use a title up to 120 characters, text up to 17,000 characters, an HTTP(S) link and an image up to 1 MB."
        case .full: "The offline inbox is full (100 captures). Upload or remove items first."
        case .corrupt: "A local research file could not be read. Your saved file was kept."
        }
        return NSLocalizedString(text, comment: "")
    }
}
/// One atomic file per capture avoids read/modify/write races with the share extension.
/// No credentials are stored here. The extension only creates unassigned captures.
public struct ResearchCaptureStore: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }
    public static func applicationStore() -> Self {
        Self(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("OpenTerminalResearch", isDirectory: true))
    }
    public static func sharedStore(bundle: Bundle = .main) throws -> Self {
        #if os(iOS)
        guard let group = bundle.object(forInfoDictionaryKey: "OpenTerminalAppGroup") as? String,
              let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw ResearchStorageError.unavailable }
        return Self(root: url.appendingPathComponent("ResearchInbox", isDirectory: true))
        #else
        throw ResearchStorageError.unavailable
        #endif
    }
    private func directory(_ name: String) throws -> URL {
        var url = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
        return url
    }
    private func write<T: Encodable>(_ value: T, to url: URL) throws {
        let data = try JSONEncoder().encode(value)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: .atomic)
        #endif
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    public func captures() throws -> [ResearchCapture] {
        let dir = try directory("captures")
        return try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey]).filter { $0.pathExtension == "json" }.map { url in
            guard (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? Int.max <= 1_600_000 else { throw ResearchStorageError.corrupt }
            let value: ResearchCapture
            do { value = try JSONDecoder().decode(ResearchCapture.self, from: Data(contentsOf: url)); try value.validate() }
            catch { throw ResearchStorageError.corrupt }
            guard url.deletingPathExtension().lastPathComponent == value.clientId.uuidString.lowercased() else { throw ResearchStorageError.corrupt }
            return value
        }.sorted { $0.createdAt < $1.createdAt }
    }
    public func save(_ capture: ResearchCapture) throws {
        try capture.validate()
        let url = try directory("captures").appendingPathComponent(capture.clientId.uuidString.lowercased() + ".json")
        if !FileManager.default.fileExists(atPath: url.path), try captures().count >= 100 { throw ResearchStorageError.full }
        try write(capture, to: url)
    }
    public func remove(_ id: UUID) throws {
        let url = try directory("captures").appendingPathComponent(id.uuidString.lowercased() + ".json")
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    private func scope(_ origin: String) -> String { SHA256.hash(data: Data(origin.utf8)).map { String(format: "%02x", $0) }.joined() }
    private func draftURL(origin: String, symbol: String) throws -> URL {
        guard symbol.range(of: "^[A-Z0-9.^=&-]{1,20}$", options: .regularExpression) != nil else { throw ResearchStorageError.invalidCapture }
        return try directory("drafts/" + scope(origin)).appendingPathComponent(symbol + ".json")
    }
    public func draft(origin: String, symbol: String) throws -> StoredResearchDraft? {
        let url = try draftURL(origin: origin, symbol: symbol)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        guard (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? Int.max <= 200_000 else { throw ResearchStorageError.corrupt }
        do { return try JSONDecoder().decode(StoredResearchDraft.self, from: Data(contentsOf: url)) }
        catch { throw ResearchStorageError.corrupt }
    }
    public func saveDraft(_ draft: StoredResearchDraft, origin: String, symbol: String) throws {
        guard draft.title.utf16.count <= 120, draft.body.utf16.count <= 20000 else { throw ResearchStorageError.invalidCapture }
        let url = try draftURL(origin: origin, symbol: symbol)
        if draft.title.isEmpty && draft.body.isEmpty { if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }; return }
        try write(draft, to: url)
    }
    public func clear(origin: String) throws {
        let folder = root.appendingPathComponent("drafts/" + scope(origin))
        if FileManager.default.fileExists(atPath: folder.path) { try FileManager.default.removeItem(at: folder) }
        for capture in try captures() where capture.origin == origin { try remove(capture.id) }
    }
}
