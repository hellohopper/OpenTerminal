import SwiftUI
import OpenTerminalCore

// Use the property-wrapper type across SDKs that also expose a State macro.
typealias ViewState<Value> = SwiftUI.State<Value>

@main struct OpenTerminalApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PhoneDelegate.self) private var delegate
    #endif
    @StateObject private var model = TerminalModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group { if model.restoring { ProgressView("Connecting to your Mac…") } else if model.signedIn { TerminalTabs() } else { SignInView() } }
                .environmentObject(model)
                .tint(.orange)
                .overlay { if phase != .active && model.signedIn { Color.black.ignoresSafeArea().overlay { Label("OpenTerminal", systemImage: "lock.fill").foregroundStyle(.orange) } } }
                .onChange(of: phase) { _, value in if value == .active && model.signedIn { Task { await model.refresh() } } }
                .task { await model.restoreSession() }
                .onReceive(NotificationCenter.default.publisher(for:.init("terminal-open-research"))) { value in if let symbol=value.object as? String,let normalized=normalizedSymbol(symbol){model.researchSymbol=normalized} }
                .onOpenURL { url in
                    guard url.scheme=="openterminal",url.host=="connect",let address=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="server"})?.value,let server=try? ServerConnection(address)else{return}
                    if model.signedIn{model.error=nativeText("Sign out before connecting to another server.")}else{model.serverText=server.origin.absoluteString}
                }
                .sheet(isPresented:Binding(get:{model.signedIn && model.researchSymbol != nil},set:{if !$0{model.researchSymbol=nil}})) { NavigationStack { if let symbol=model.researchSymbol { ResearchView(symbol:symbol, isModal:true) } }.environmentObject(model) }
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
                    TextField("Device name",text:$model.deviceName)
                    Toggle("Remember this device",isOn:$model.rememberDevice)
                }
                if let error = model.error { Section { Text(error).foregroundStyle(.red) } }
                Section {
                    Button("Reconnect saved device") { Task { await model.restoreSession(force:true) } }.disabled(model.busy||model.restoring)
                    Button { let value = password; password = ""; Task { await model.signIn(password: value) } } label: {
                        if model.busy { ProgressView() } else { Text("Sign in") }
                    }.disabled(model.busy || password.isEmpty || model.serverText.isEmpty)
                } footer: {
                    Text("Connect to the Mac’s HTTPS web address with Tailscale enabled. Remember this device stores a revocable device token in Keychain; your owner password and the server API key are never saved on the phone.")
                }
            }.navigationTitle("Connect")
        }
    }
}
extension View {
    @ViewBuilder func terminalPriceInput() -> some View {
        #if os(iOS)
        keyboardType(.decimalPad)
        #else
        self
        #endif
    }
    @ViewBuilder func terminalInput(ticker: Bool = false) -> some View {
        #if os(iOS)
        textInputAutocapitalization(ticker ? .characters : .never).autocorrectionDisabled().keyboardType(ticker ? .asciiCapable : .URL).submitLabel(ticker ? .done : .go)
        #else
        autocorrectionDisabled()
        #endif
    }
}
