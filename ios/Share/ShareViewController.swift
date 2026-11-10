import UIKit
import SwiftUI
import UniformTypeIdentifiers
import OpenTerminalCore

@MainActor final class ShareViewController: UIViewController {
    private let model = ShareCaptureModel()
    override func viewDidLoad() {
        super.viewDidLoad()
        let hosting = UIHostingController(rootView: ShareCaptureView(model: model, save: { [weak self] in self?.save() }, cancel: { [weak self] in self?.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled)) }))
        addChild(hosting); view.addSubview(hosting.view); hosting.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([hosting.view.topAnchor.constraint(equalTo: view.topAnchor), hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor), hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        hosting.didMove(toParent: self)
        Task { await loadAttachments() }
    }
    private func stringItem(_ provider: NSItemProvider, type: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { item, error in
                if let error { continuation.resume(throwing: error) }
                else if let url = item as? URL { continuation.resume(returning: url.absoluteString) }
                else if let string = item as? String { continuation.resume(returning: string) }
                else { continuation.resume(throwing: ResearchStorageError.invalidCapture) }
            }
        }
    }
    private func imageData(_ provider: NSItemProvider, type: String) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: type) { data, error in
                if let error { continuation.resume(throwing: error) }
                else if let data { continuation.resume(returning: data) }
                else { continuation.resume(throwing: ResearchStorageError.invalidCapture) }
            }
        }
    }
    private func loadAttachments() async {
        defer { model.loading = false }
        do {
            let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
            let providers = items.flatMap { $0.attachments ?? [] }
            // The activation rule accepts one image/link and optional text; reject ambiguous batches.
            var images = 0, urls = 0
            for provider in providers {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    urls += 1; guard urls <= 1 else { throw ResearchStorageError.invalidCapture }
                    model.url = try await stringItem(provider, type: UTType.url.identifier)
                } else if let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true }) {
                    images += 1; guard images <= 1 else { throw ResearchStorageError.invalidCapture }
                    let data = try await imageData(provider, type: type)
                    guard data.count <= 20_000_000, let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else { throw ResearchStorageError.invalidCapture }
                    let scale = min(1, 1600 / max(image.size.width, image.size.height)), size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                    let format = UIGraphicsImageRendererFormat(); format.scale = 1
                    let reduced = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                    guard let jpeg = reduced.jpegData(compressionQuality: 0.7), jpeg.count <= 1_048_576 else { throw ResearchStorageError.invalidCapture }
                    model.image = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    let text = try await stringItem(provider, type: UTType.plainText.identifier)
                    model.text += (model.text.isEmpty ? "" : "\n\n") + text
                }
            }
            if model.title.isEmpty { model.title = String((items.first?.attributedTitle?.string ?? URL(string: model.url)?.host ?? NSLocalizedString("Shared research", comment: "")).prefix(100)) }
            guard model.text.utf16.count <= 17000, model.url.utf16.count <= 2000 else { throw ResearchStorageError.invalidCapture }
        } catch { model.error = error.localizedDescription; model.attachmentFailed = true }
    }
    private func save() {
        guard !model.loading, !model.attachmentFailed else { return }
        do {
            try ResearchCaptureStore.sharedStore().save(ResearchCapture(title: model.title.trimmingCharacters(in: .whitespacesAndNewlines), text: model.text, url: model.url, image: model.image))
            extensionContext?.completeRequest(returningItems: nil)
        } catch { model.error = error.localizedDescription }
    }
}
@MainActor private final class ShareCaptureModel: ObservableObject {
    @Published var title = ""
    @Published var text = ""
    @Published var url = ""
    @Published var image: String?
    @Published var loading = true
    @Published var attachmentFailed = false
    @Published var error: String?
}
private struct ShareCaptureView: View {
    @ObservedObject var model: ShareCaptureModel
    let save: () -> Void
    let cancel: () -> Void
    var body: some View {
        NavigationStack {
            Form {
                if model.loading { ProgressView("Loading shared content…") }
                TextField("Title", text: $model.title)
                TextField("Source URL", text: $model.url).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextEditor(text: $model.text).frame(minHeight: 150).accessibilityLabel("Quick thought")
                if model.image != nil { Label("Includes screenshot", systemImage: "photo") }
                Text("Saved locally. Open OpenTerminal and choose Upload in Research Inbox to send it to your server.").font(.caption)
                if let error = model.error { Text(error).foregroundStyle(.red) }
            }.navigationTitle("Research inbox").toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(model.loading || model.attachmentFailed || model.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
        }.tint(.orange)
    }
}
