import Foundation
import Combine
import OpenTerminalCore

@MainActor final class ResearchInboxModel: ObservableObject {
    @Published private(set) var captures: [ResearchCapture] = []
    @Published private(set) var uploading: Set<UUID> = []
    @Published var error: String?
    @Published var message: String?
    private weak var terminal: TerminalModel?
    private var authorization: AnyCancellable?
    private var sources: [UUID: ResearchCaptureStore] = [:]
    init(terminal: TerminalModel) {
        self.terminal = terminal
        authorization = terminal.$signedIn.sink { [weak self] signedIn in
            if !signedIn { self?.captures = []; self?.sources = [:]; self?.uploading = []; self?.error = nil; self?.message = nil }
        }
    }
    func load() {
        guard let terminal, terminal.signedIn, let origin = terminal.server?.origin.absoluteString else { return }
        do {
            var sources: [UUID: ResearchCaptureStore] = [:], captures: [ResearchCapture] = []
            let stores = [terminal.researchFiles, try? ResearchCaptureStore.sharedStore()].compactMap { $0 }
            for store in stores { for capture in try store.captures() where capture.origin == nil || capture.origin == origin {
                if sources[capture.id] == nil { captures.append(capture); sources[capture.id] = store }
            } }
            self.sources = sources; self.captures = captures.sorted { $0.createdAt < $1.createdAt }; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func collect(title: String, text: String, url: String, symbol: String? = nil) -> Bool {
        guard let terminal, terminal.signedIn, let origin = terminal.server?.origin.absoluteString, let store = terminal.researchFiles else { return false }
        do {
            let capture = ResearchCapture(title: title.trimmingCharacters(in: .whitespacesAndNewlines), text: text, url: url, symbol: symbol, origin: origin)
            try store.save(capture); load(); message = nativeText("Saved on this device. Upload will retry while the app is active."); return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func remove(_ capture: ResearchCapture) {
        guard terminal?.signedIn == true, !uploading.contains(capture.id), let store = sources[capture.id] else { return }
        do { try store.remove(capture.id); load() } catch { self.error = error.localizedDescription }
    }
    func upload(_ capture: ResearchCapture) async {
        guard let terminal, terminal.signedIn, let api = terminal.api, let origin = terminal.server?.origin.absoluteString,
              capture.origin == nil || capture.origin == origin, !uploading.contains(capture.id), let store = sources[capture.id] else { return }
        let session = terminal.sessionID
        uploading.insert(capture.id); error = nil
        defer { if terminal.sessionID == session { uploading.remove(capture.id) } }
        do {
            // Bind durably before sending. Unassigned extension items need an explicit upload tap.
            var bound = capture; bound.origin = origin; try store.save(bound)
            let _: Acknowledgement = try await api.post("/api/research-inbox", body: bound.upload)
            guard terminal.sessionID == session, terminal.signedIn else { return }
            try store.remove(bound.id); load(); message = nativeText("Uploaded to your research inbox.")
        } catch {
            guard terminal.sessionID == session, terminal.signedIn else { return }
            self.error = error.localizedDescription
            if error as? ConnectionError == .unauthorized { await terminal.report(error) }
        }
    }
    func refreshAndUpload() async {
        guard let terminal, terminal.signedIn else { return }; let session = terminal.sessionID
        load()
        for capture in captures where capture.origin != nil {
            guard !Task.isCancelled, terminal.sessionID == session, terminal.signedIn else { break }
            await upload(capture)
        }
    }
}
