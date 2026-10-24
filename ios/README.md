# OpenTerminal for iPhone and iPad

A native SwiftUI companion for the existing self-hosted web terminal. Requires iOS/iPadOS 17 or later and Xcode 16 or later. There are no third-party Swift dependencies.

## Run

1. Keep the existing web and API services running at an HTTPS origin your phone can reach. Set `WEB_ORIGIN` to that exact origin. Use the web server URL, not the API port; shared API keys remain on the server.
2. Open `ios/OpenTerminal.xcodeproj` in full Xcode and choose the **OpenTerminal** scheme. Select a simulator and Run. For a physical device, select your signing team and a bundle identifier you control under Signing & Capabilities.
3. Enter the web server origin (for example `https://terminal.example.com`) and the same owner password used by the website. HTTPS certificates must be trusted by the device. There is no TLS validation bypass. HTTP is accepted only for loopback development (`http://127.0.0.1:3100` on a simulator); a phone's localhost is the phone itself.

The app uses `/api/session`, stores its HttpOnly cookie in an ephemeral URLSession, and sends the expected Origin header on mutations. It never receives or stores the shared API key. Passwords, account responses and session cookies are not persisted by the app; force-quitting requires signing in again. The server's 12-hour expiry applies. Redirects are not followed by the API client. The app covers inactive app previews. Only the server address and a separate per-server watchlist are stored in UserDefaults.

## Features

- Today: personal briefing, market indexes, headlines and position-only holdings summary.
- Watchlist: add/remove symbols and open native research. Lists are local to this device and scoped to the chosen server.
- Holdings: choose an existing portfolio, inspect positions and open company research. Values exclude cash and withhold totals for missing, expired, stale or non-USD quotes. Use the full web terminal for transaction management.
- Alerts: create price-above/below rules and pause/rearm existing rules on the shared server.
- Research: native Swift Charts price history, news links, persistent server research notes and the native share sheet for authenticated research links. A provider error does not block other research sections.
- Saved layouts: publish a reviewed device snapshot in the website's Sync panel, then choose Settings → Load published layouts. Importing a chosen layout's watchlist asks before replacing the local list. It does not write or overwrite web layouts.
- Full research and professional tools remain available through links to the web terminal. That browser has its own login session.

The app refreshes while active, supports pull-to-refresh and stops periodic work when backgrounded. Prices are indicative provider data. Offline/API errors are shown; market and account responses are not cached to disk. Native background push/APNs is not implemented; the installed PWA from [the mobile guide](../docs/ui-modes-mobile.md) provides the existing Web Push path. Native screens currently use English strings and system text sizing.

## Validate

With full Xcode selected:

```sh
swift test --disable-xctest --package-path ios
xcodebuild -project ios/OpenTerminal.xcodeproj -scheme OpenTerminal \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/OpenTerminalDerived CODE_SIGNING_ALLOWED=NO build
```

The `iOS` GitHub Actions workflow runs those checks on macOS. The portable core tests cover server origin validation, query encoding, session headers/expiry, alert writes, provider errors and incomplete holdings valuations.

Local validation in the authoring environment: core tests and SwiftUI source type checking against the installed macOS SDK. That environment has only Command Line Tools, so an iOS SDK build, simulator launch, device networking, touch/VoiceOver checks and signing still need full Xcode. Source type checking is not an iOS simulator build.

For Command Line Tools installations that do not discover the bundled Swift Testing plugin, pass `-Xswiftc -load-plugin-library -Xswiftc /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib` to `swift test`. The exact plugin path depends on the selected toolchain.

## Distribution

The repository includes a shared scheme, app icon and UserDefaults required-reason privacy manifest. Before a TestFlight/App Store upload, use your Apple Developer team, configure signing and App Store Connect metadata for your deployment, and verify on a real device. This repository does not contain signing credentials or claim that the app is already distributed. Apple's [app icon guide](https://developer.apple.com/documentation/xcode/configuring-your-app-icon) and [required-reason API documentation](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype) describe the relevant project resources.
