import SwiftUI

// Use the property-wrapper type across SDKs that also expose a State macro.
typealias ViewState<Value> = SwiftUI.State<Value>

@main struct OpenTerminalApp: App {
    @StateObject private var model = TerminalModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group { if model.signedIn { TerminalTabs() } else { SignInView() } }
                .environmentObject(model)
                .tint(.orange)
                .overlay { if phase != .active && model.signedIn { Color.black.ignoresSafeArea().overlay { Label("OpenTerminal", systemImage: "lock.fill").foregroundStyle(.orange) } } }
                .onChange(of: phase) { _, value in if value == .active && model.signedIn { Task { await model.refresh() } } }
        }
    }
}

private struct SignInView: View {
    @EnvironmentObject private var model: TerminalModel
    @ViewState<String> private var password = ""
    var body: some View {
        NavigationStack {
            Form {
                Section { Label("OpenTerminal", systemImage: "terminal.fill").font(.title2) }
                Section("Your server") {
                    TextField("https://terminal.example.com", text: $model.serverText).terminalInput()
                    SecureField("Terminal password", text: $password).textContentType(.password)
                }
                if let error = model.error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button { let value = password; password = ""; Task { await model.signIn(password: value) } } label: {
                        if model.busy { ProgressView() } else { Text("Sign in") }
                    }.disabled(model.busy || password.isEmpty || model.serverText.isEmpty)
                } footer: {
                    Text("Connect to your HTTPS web server, using the same owner password as the website. The API key stays on your server. Your password and session are kept only in memory; sign in again after closing the app.")
                }
            }.navigationTitle("Connect")
        }
    }
}
extension View {
    @ViewBuilder func terminalInput() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
        #else
        autocorrectionDisabled()
        #endif
    }
}
