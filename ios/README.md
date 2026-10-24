# OpenTerminal for iPhone and iPad

A native SwiftUI companion for the existing self-hosted web terminal. Requires iOS/iPadOS 17 or later and Xcode 16 or later. There are no third-party Swift dependencies.

## Run

1. Keep the existing web and API services running at an HTTPS origin your phone can reach. For a Mac Studio backend with home/cellular access, follow the [repo-local service and Tailscale guide](../docs/mac-studio.md). Set `WEB_ORIGIN` to that exact origin and give both web/API processes the same `WEB_PASSWORD` and `WEB_SESSION_SECRET`. Use the web server URL, not the API port; shared API keys remain on the server.
2. Open `ios/OpenTerminal.xcodeproj` in full Xcode and choose the **OpenTerminal** scheme. Select a simulator and Run. For a physical device, select your signing team and a bundle identifier you control under Signing & Capabilities.
3. Enter the web server origin (for example `https://terminal.example.com`) and the same owner password used by the website. HTTPS certificates must be trusted by the device. There is no TLS validation bypass. HTTP is accepted only for loopback development (`http://127.0.0.1:3100` on a simulator); a phone's localhost is the phone itself.

The app pairs through `/api/mobile/session` and sends a device Bearer token plus the expected Origin header on mutations. Remember this device saves the token in a server-scoped, non-synchronizing Keychain item accessible only while this device is unlocked. Passwords and the shared API key are never persisted on the phone. Backend storage contains only token hashes; authorization expires after 30 inactive days and is renewed on use. Revoke phones in native Settings or web UI settings → Devices. Password/session-secret changes invalidate phone tokens. Temporary network errors retain saved authorization and expose a reconnect action. Redirects are not followed and inactive app previews are covered. UserDefaults contains the server address and selected list ID; business data remains on the Mac. The portable client retains its older cookie sign-in API for compatibility, but this app uses device authorization.

## Features

- Today: personal briefing, market indexes, headlines and position-only holdings summary.
- Watchlist: choose a backend shared list, add/remove symbols atomically and open native research. Web workspaces can select the same list. The first phone creates a shared list from its legacy local list, or defaults, only if the server has no lists.
- Holdings: choose an existing portfolio, inspect positions and open company research. Values exclude cash and withhold totals for missing, expired, stale or non-USD quotes. Use the full web terminal for transaction management.
- Alerts: create price-above/below rules and pause/rearm existing rules on the shared server.
- Research: native Swift Charts price history, news links, persistent server research notes and the native share sheet for authenticated research links. A provider error does not block other research sections.
- Saved layouts: publish a reviewed device snapshot in the website's Sync panel, then choose Settings → Load published layouts. Importing a chosen layout's watchlist asks before replacing the selected shared list and rejects stale versions. It does not write or overwrite web layouts.
- Native notifications: register this phone in Settings after configuring APNs and signing. Background delivery uses the existing alert/signal queue and quiet-hour policy; tapping a symbol notification opens native research. Revoking the phone removes its native registration.
- Full research and professional tools remain available through links to the web terminal. That browser has its own login session.

The app enters its main interface after authorization succeeds, then loads watchlists, holdings, alerts and briefings independently. A slow or failing data section does not block the other sections; each shows loading, errors and its own last-success time. The app refreshes while active, supports pull-to-refresh and stops periodic work when backgrounded. It distinguishes offline, timeout, unreachable-server and certificate errors and backs off retries. Settings → Server health checks connection, backup status and push configuration without changing server settings. Prices are indicative provider data; market and account responses are not cached to disk. The installed PWA from [the mobile guide](../docs/ui-modes-mobile.md) retains its separate Web Push path. Native screens currently use English strings and system text sizing.

## Push signing

The project includes `OpenTerminal.entitlements` with `aps-environment`: development for Debug and production for Release. Use a bundle ID with Push Notifications enabled and a matching provisioning profile from your Apple Developer team. Put the APNs `.p8` key inside the backend checkout's `config/` directory and configure its key ID, team ID, topic and sandbox/production environment as described in the [Mac guide](../docs/mac-studio.md#optional-native-push-notifications). Keys are never embedded in the app. Debug tokens require sandbox; TestFlight/Release tokens require production. Real background delivery must be checked on a signed physical device.

For a personal-team development build without the Push capability, clear the target's Code Signing Entitlements build setting (`CODE_SIGN_ENTITLEMENTS`) locally and leave native notifications disabled. The foreground app and server alert rules still work; APNs requires a team/profile that supports Push Notifications.

## Validate

With full Xcode selected:

```sh
swift test --disable-xctest --package-path ios
xcodebuild -project ios/OpenTerminal.xcodeproj -scheme OpenTerminal \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/OpenTerminalDerived CODE_SIGNING_ALLOWED=NO build
```

The `iOS` GitHub Actions workflow runs those checks on macOS when Actions is enabled for the repository. The portable core tests cover server origin validation, query encoding, device pairing/renewal/Bearer headers, session expiry, network failures, alert writes, provider errors and incomplete holdings valuations. A separate app-model test target compiles the production model/credential adapter and covers startup, stalled requests, independent section failures, retry recovery, logout during refresh and partial health results with an in-memory credential store and simulated network responses.

Local validation in the authoring environment: core tests and SwiftUI source type checking against the installed macOS SDK. That environment has only Command Line Tools, so an iOS SDK build, simulator launch, device networking, touch/VoiceOver checks and signing still need full Xcode. Source type checking is not an iOS simulator build.

For Command Line Tools installations that do not discover the bundled Swift Testing plugin, pass `-Xswiftc -load-plugin-library -Xswiftc /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib` to `swift test`. The exact plugin path depends on the selected toolchain.

## Distribution

The repository includes a shared scheme, app icon and UserDefaults required-reason privacy manifest. Before a TestFlight/App Store upload, use your Apple Developer team, configure signing and App Store Connect metadata for your deployment, and verify on a real device. This repository does not contain signing credentials or claim that the app is already distributed. Apple's [app icon guide](https://developer.apple.com/documentation/xcode/configuring-your-app-icon) and [required-reason API documentation](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype) describe the relevant project resources.
