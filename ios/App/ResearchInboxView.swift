import SwiftUI
import OpenTerminalCore

struct ResearchInboxView: View {
    @EnvironmentObject private var terminal: TerminalModel
    var body: some View { ResearchInboxContent(model: terminal.researchInbox).environmentObject(terminal) }
}
private struct ResearchInboxContent: View {
    @EnvironmentObject private var terminal: TerminalModel
    @ObservedObject var model: ResearchInboxModel
    @ViewState<String> private var title = ""
    @ViewState<String> private var thought = ""
    @ViewState<String> private var sourceURL = ""
    @ViewState<ResearchCapture?> private var removing = nil
    var body: some View {
        List {
            Section("Quick capture") {
                TextField("Title", text: $title)
                TextField("Source URL", text: $sourceURL).terminalInput()
                TextEditor(text: $thought).frame(minHeight: 100).accessibilityLabel("Quick thought")
                Button("Save to inbox") {
                    if model.collect(title: title, text: thought, url: sourceURL) {
                        title = ""; thought = ""; sourceURL = ""
                        Task { await model.refreshAndUpload() }
                    }
                }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Text("Saved captures survive closing the app. Uploads retry while the app is active; organize uploaded items in the web Research Inbox.").font(.caption).foregroundStyle(.secondary)
            }
            if let error = model.error { Section { Text(error).foregroundStyle(.orange) } }
            if let message = model.message { Section { Text(message).foregroundStyle(.secondary) } }
            Section("On this device") {
                if model.captures.isEmpty { Text("No captures waiting to upload.").foregroundStyle(.secondary) }
                ForEach(model.captures) { capture in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(capture.title).font(.headline)
                        Text(capture.text).lineLimit(6)
                        if let url = URL(string: capture.url), ["https", "http"].contains(url.scheme) { Link(capture.url, destination: url) }
                        if capture.image != nil { Label("Includes screenshot", systemImage: "photo") }
                        Text(LocalizedStringKey(capture.origin == nil ? "Shared capture: choose Upload to send this item to the signed-in server." : "Waiting for the signed-in server.")).font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button("Upload") { Task { await model.upload(capture) } }
                            Button("Remove", role: .destructive) { removing = capture }
                            if model.uploading.contains(capture.id) { ProgressView() }
                        }.buttonStyle(.borderless).disabled(model.uploading.contains(capture.id))
                    }
                }
            }
            if let server = terminal.server { Section { Link("Open web terminal", destination: server.origin) } }
        }.navigationTitle("Research inbox")
            .task { await model.refreshAndUpload() }
            .refreshable { await model.refreshAndUpload() }
            .alert("Remove local capture?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
                Button("Remove", role: .destructive) { if let capture = removing { model.remove(capture) }; removing = nil }
                Button("Cancel", role: .cancel) { removing = nil }
            } message: { Text("This removes the local copy. A copy already received by the server remains in the web inbox.") }
    }
}
