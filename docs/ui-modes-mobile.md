# Layouts, interface modes and mobile

## Named layouts

The workspace selector stores named layouts. Changes save automatically in this browser. **Save layout as…** creates an independent copy, including panel settings, grid positions, hidden panels, sidebar shortcuts, favorites and collapsed groups. Optionally include font, language and density; otherwise those remain device preferences. Existing workspaces retain their configuration.

Layouts are locked on selection and reload. **Edit layout** enables dragging and resizing; **Finish editing** locks them again. Adding, hiding and removing panels still uses the existing controls and removal undo.

Manage supports presets, rename, duplicate, delete and JSON import/export. Exports and reviewed device snapshots include layout presentation choices. Imports create a new workspace; syncing uses the existing preview and conflict checks.

## Simple and professional modes

Use **Mode** in the header to switch interfaces. Professional mode retains the full panel library. Simple mode has Today, Watchlist, Holdings and Research navigation, with alerts available from Today. Mode and the last simple page are remembered on this device, independently of desktop grid coordinates. Existing users start in professional mode.

**Customize home** selects the briefing, watchlist, holdings and alert cards. These choices belong to the named workspace and travel with exports and device snapshots. Holdings show position value, excluding cash; incomplete quotes withhold totals. **Open portfolio tools** opens the full portfolio editor in professional mode. Opening advanced panels through command search also switches to professional mode.

Simple stock research shows Overview, Chart, Financials, News and Notes first; **More research** exposes every advanced section. Source content and user records remain unchanged by the language preference. Clocks and provider diagnostics are under **Connection status**.

## Phone and home screen app

A fresh phone session starts in simple mode. A saved mode choice is respected. Simple mode uses a persistent bottom navigation bar; professional mode retains its existing mobile workspace and tools. Touch targets, safe areas and large text are supported without changing desktop grid coordinates.

**Install app** explains Safari → Share → Add to Home Screen on iPhone/iPad and offers the browser install prompt where supported. PNG icons, an Apple touch icon and standalone metadata are included. Serve the web app over HTTPS at a URL the phone can reach; the API remains behind the authenticated web proxy. A desktop localhost address is not the phone's server. Configure WEB_ORIGIN to match the public HTTPS origin and keep the web/API services available.

The worker caches only a public, bilingual offline page and its icon. It never caches authenticated HTML or API/account responses. An open page shows an offline warning; navigating or reloading offline displays the fallback. Reconnect and retry to return to the app. This is not offline market data or offline transaction editing.

Background notifications reuse `/sw.js` and the existing Notifications panel. Configure WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT on the API, enable background delivery and register the installed device. iOS/iPadOS home-screen Web Push requires a supported OS (16.4+) and explicit notification permission. Device delivery and connectivity must be tested on the target phone.

## Native iOS companion

The [native app](../ios/README.md) adds SwiftUI screens for Today, Watchlist, Holdings, Alerts and stock research, using the same authenticated web API. It includes an Xcode project and a Swift package with core connection/valuation tests. Native research supports chart history, news, server notes and sharing research links. Published web snapshots can supply a local watchlist after review. Advanced desktop tools open in the web terminal. Native push/APNs and App Store distribution are not included; use the PWA for existing Web Push. See the app guide for Xcode, signing and validation requirements.
