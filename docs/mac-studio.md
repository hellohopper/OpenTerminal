# Mac Studio backend and iPhone access

Run the production web/API services on the Mac with authenticated local access first. Double-click `OpenTerminal.command` in this checkout for a Terminal menu with start, stop, restart, status, health, browser and configuration actions. Opening the menu does not start services or reveal credentials.

Optionally connect the native iOS app through a private Tailscale HTTPS address. The same address works on home Wi-Fi and cellular when both devices are online in the same tailnet. Tailscale Serve exposes the authenticated web server to your tailnet; it does not publish a public Funnel or require router port forwarding.

## Files stay in this checkout

| Directory | Contents |
| --- | --- |
| `data/` | SQLite `terminal.db`, WAL files and server records |
| `config/` | `server.json`, optional APNs key, launchd plists and login launcher app |
| `logs/` | API/web output and launchd diagnostics |
| `backups/` | Scheduled business-data backups, policy and scheduler status |

These directories are ignored by Git except `config/server.example.json` and `config/server.local.example.json`. The Mac service explicitly selects local SQLite, overrides inherited database/path settings, and binds both processes to `127.0.0.1`. It never creates an application data folder or LaunchAgents file under your home directory. macOS itself retains a login-item registration pointing at the launcher inside this checkout. The iPhone retains its own device credential in its Keychain.

Existing `data/terminal.db` is reused and migrated. Existing backups under `data/backups/` are left intact; the Mac service writes new scheduled backups to `backups/`. Setup enables one daily backup at 07:00 UTC with 14-file retention. Change the schedule in the web Data panel. Device login credentials are excluded from business-data JSON backups; raw SQLite copies contain credential hashes. The owner password and signing keys are in `config/`, so protect that directory separately. Logs rotate at 5 MiB with three archives per application stream.

Keep this checkout downloaded and available to the Mac. If it lives in Dropbox, do not run a second backend against the same live SQLite files on another computer. A second independent deployment should use a separate checkout and an exported business-data backup.

## First installation: local access

Install Node.js 22.12 or newer and dependencies (`npm ci`). From this repository:

```sh
node scripts/mac-service.mjs setup --local
node scripts/mac-service.mjs credentials
node scripts/mac-service.mjs build
node scripts/mac-service.mjs start
node scripts/mac-service.mjs open
```

`setup --local` creates authenticated access at **http://127.0.0.1:3000**. Use that exact address; `localhost` is a different origin for login and mutation checks. Optional `--web-port 5100 --api-port 5101` selects distinct ports between 1024 and 65535. Both services bind to loopback; this local URL is for browsers on the Mac, not the phone.

`setup` creates owner credentials and a mode-0600 `config/server.json`; it refuses to overwrite an existing configuration. `credentials` deliberately displays the owner password in your terminal. Do not paste its output into an issue or PR. The generated config records the absolute Node executable path so login startup does not depend on an interactive shell. If Node or the checkout moves, update the path and rerun `install` if you use login startup. The `.command` menu uses this configured Node path even with Finder's minimal PATH; `OPENTERMINAL_NODE` can explicitly override it.

`start` prepares the repository-local launchd files itself, starts both services for the current login, and waits for actual local web/API responses before reporting readiness. Missing production builds fail before any service is changed. Login startup is optional: select **Enable login startup** in the menu or run `node scripts/mac-service.mjs install`. Registration may trigger macOS System Events permission. Services restart after a crash; successful login-item registration also starts them after login. The API wrapper runs `caffeinate` while active unless `keepAwake` is false. A FileVault-protected reboot still requires an unlock/login before this user service and encrypted checkout are available.

For an existing HTTPS configuration, stop both managed services before switching:

```sh
node scripts/mac-service.mjs stop
node scripts/mac-service.mjs access local
node scripts/mac-service.mjs start
```

`access local` preserves credentials, ports and other settings. It saves the previous configuration privately in `config/server.previous.json` before atomically writing the local configuration. Repeating it while already local keeps that backup. The command refuses to change configuration while either managed job is registered. It changes this application's canonical access URL; it does not remove any independently configured Tailscale Serve or other proxy route. Those routes must be inspected and managed explicitly.

On an external volume with ownership disabled, macOS may reject an otherwise valid plist with `Bootstrap failed: 5: Input/output error`. `start` then submits the same command directly to the user's launchd session, with the same crash-restart behavior. The application wrapper opens its repository-local logs itself; no configuration is copied into Library or a temporary directory, and volume ownership is not changed. `status` reports the launchd state, PID when present, any last exit code, and actual local web/API responses. A registered job or a `spawn scheduled` state does not prove the API is healthy.

Unlock the Mac for first installation and approve any macOS file-access prompt for the service's Node executable. If login-item registration times out, the repository-local service files remain ready and `start` can be used for the current session. Retry `install` after unlocking, or manually add `config/OpenTerminal Launcher.app` under System Settings → General → Login Items. Until that registration succeeds, startup after a new login is not configured.

## Optional private iPhone access

Install Tailscale on the Mac and phone. Sign both devices into your tailnet, enable MagicDNS/HTTPS as required by Tailscale, and read the Mac's exact `*.ts.net` DNS name from `tailscale status --json`.

For a new installation, use `setup --origin https://your-mac.your-tailnet.ts.net` instead of `setup --local`. For an existing local installation, stop the services and explicitly edit `config/server.json`: set `accessMode` to `tailscale` and `origin` to that HTTPS origin, preserving credentials and other fields. Existing HTTPS configurations without `accessMode` remain supported. Start the services, then explicitly run `node scripts/mac-service.mjs serve` to configure private forwarding. Local mode refuses the `serve` command. The menu never enables forwarding.

`serve` checks that the configured HTTPS origin matches this running Tailscale node and refuses to replace an existing Serve configuration. If a route already exists, inspect `tailscale serve status` and reconcile it explicitly. The default CLI path is `/usr/local/bin/tailscale`; set `tailscale` in `config/server.json` if your installation differs. Tailscale owns its VPN state and HTTPS certificate lifecycle outside the application.

Open the configured HTTPS address in the phone's Safari first and verify you can sign in. Keep Tailscale enabled on the phone when away from home. Then follow the [native app instructions](../ios/README.md) to install the iOS app and use the same address/password. In the website, UI settings → Devices also offers a connection link that prefills the installed app's server address without including any credentials.

## Daily operation and upgrades

```sh
npm run mac:menu
npm run mac:status
npm run mac:restart
node scripts/mac-service.mjs logs api
node scripts/mac-service.mjs logs web
node scripts/mac-service.mjs doctor
```

`status --json` returns the access mode, origin, local readiness, launchd states and HTTP checks, with exit code 1 if local responses are unhealthy. The `mac:start`, `mac:stop`, `mac:restart`, `mac:status` and `mac:doctor` npm shortcuts are also available. `restart` stops web and API before starting either, so both reload the same configuration; a failed stop prevents starting replacement jobs. It waits for local responses just like `start`.

`doctor` checks local web/API responses, backup freshness, and any configured APNs key. In Tailscale mode it also checks the configured HTTPS login page and Tailscale connectivity/hostname. In local mode it makes no Tailscale command or remote HTTPS request. A failed service, malformed response, HTTPS failure, stale/failed backup, or invalid configured push key returns exit code 1. An optional unconfigured push channel, disabled backups, or a new installation awaiting its first backup produces a warning. Scheduled backups older than 36 hours are treated as stale. `node scripts/mac-service.mjs doctor --json` returns a structured report with `ok`, check names, severity and descriptions, without credentials or key contents. The checks are read-only; push-key validation does not verify Apple delivery.

On the phone, Settings → Server health checks the authenticated backend connection, last backup result and native push configuration independently. It can show a working connection alongside a failed backup or unavailable push-status endpoint. Tailscale's local process/hostname check is available through the Mac command, not the phone screen.

For an upgrade or config/password change, stop the service, update dependencies/build, then start it again:

```sh
node scripts/mac-service.mjs stop
npm ci
node scripts/mac-service.mjs build
node scripts/mac-service.mjs start
```

`build` refuses while managed services are registered. `start` alone does not restart an already running service; use `restart` to reload configuration without rebuilding. `stop` unloads this instance. `uninstall` unloads it and removes its login registration, retaining all repository files and data. It does not remove a Tailscale Serve route; inspect and manage that route with the Tailscale CLI. A checkout-specific launchd label allows separate instances to have separate registrations, but give them distinct ports and origins.

The iOS app stores a 30-day, revocable device token in Keychain when Remember this device is selected. Opening the app renews valid authorization; inactive phones must sign in again after expiry. The backend stores only token hashes. UI settings → Devices lists and revokes phones; revocation also removes that phone's native push registration. Changing either the owner password or session secret invalidates existing phone tokens after restarting both services. The app keeps saved authorization on temporary network errors, retries active refreshes with backoff, and displays the last successful refresh time. It does not save account or market responses to disk.

## Shared watchlists

On the web Watchlist panel, expand Shared watchlists, enter a name and Publish current list. Select that list as the source in any web workspace and in the phone's Watchlist picker. Shared list contents live in the Mac database and refresh on active clients. Symbol additions/removals are atomic, so simultaneous edits do not replace one another. Full-list replacement checks the current version and rejects stale writes. Up to 20 shared lists with 150 symbols each are supported.

Use **Create empty list** to start fresh, or **Manage shared lists** to rename, delete and change list order with the arrow buttons. The selected shared list also exposes symbol-order buttons. On iOS, Watchlist → **Manage shared lists** offers creation, copying, renaming, deletion and list ordering; long-press a watchlist symbol to move it up or down. Both orders are saved in the existing Mac database and included in its backups.

Deletion asks for confirmation and affects every device. Renaming, deletion and symbol ordering reject stale versions, then refresh the latest list for review. After a selected list disappears, the web workspace restores its saved local list; iOS selects the next available list or shows an empty state. Deleting the last list intentionally keeps the server empty: an older or newly connected phone cannot recreate defaults on refresh. Create a new list explicitly to resume. The default list is initialized only on a server that has never had shared lists.

Local workspace lists remain available as a separate source; switching back restores the original local symbols. Named page layouts, simple/professional mode, and reviewed layout snapshots continue to use the existing settings/sync tools. On iOS, importing a published layout's symbols asks before replacing the selected shared watchlist.

## Optional native push notifications

Without APNs credentials the native app still works; alert rules and the notification inbox remain server data. To deliver notifications while the phone is backgrounded, use your Apple Developer account to enable Push Notifications for the app's bundle ID, generate an APNs signing key, and use a matching provisioning profile. Store the `.p8` key inside `config/`, restrict it to mode 0600, and add these fields to `config/server.json`:

```json
{
  "apnsKeyFile": "config/AuthKey_YOURKEYID.p8",
  "apnsKeyId": "ABCDEFGHIJ",
  "apnsTeamId": "KLMNOPQRST",
  "apnsTopic": "your.actual.bundle.identifier",
  "apnsEnvironment": "sandbox"
}
```

Merge these fields into the existing configuration without replacing generated credentials. Restart the API/web services. Debug builds use sandbox APNs; Release/TestFlight builds use production APNs, so set `apnsEnvironment` accordingly. Set the same bundle ID and your signing team in Xcode; the project includes an `aps-environment` entitlement. Do not commit your key or provisioning credentials.

In native Settings, choose Enable native notifications and grant iOS permission. This explicitly registers the phone and enables server background delivery while retaining its existing quiet hours/timezone and checking the settings version. Later automatic registration restores only the phone registration; it does not re-enable server delivery if you have disabled it. The existing delivery queue handles retries and removes expired registrations. Tapping a symbol notification opens native research. Web Push remains a separate optional channel with its existing VAPID settings.

The Mac must remain online and the monitor must observe a matching alert/signal before it can queue delivery. Permission, provisioning, sandbox/production alignment and actual background delivery must be verified on a physical phone. See [Apple APNs token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns) and [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

## Validation boundaries

Automated coverage exercises credential expiry/renewal/revocation, hashed storage, password changes, concurrent watchlist edits, stale replacements, APNs JWT/request construction, and repository-local service configuration, local access conversion, readiness failures, restart ordering and the Finder-style control launcher. Service-control tests use temporary checkouts and simulated launchctl/network responses; they do not register login items or restart the live backend. A browser test pairs a simulated phone through the production web proxy, edits its list from the web UI, and confirms revocation blocks both API reads and renewal.

Swift core tests and source type checking do not replace an iOS SDK build. Full Xcode, physical-device networking and APNs delivery require the deployment owner's signing setup. The iOS workflow is included for an Actions-enabled repository; no successful hosted build or App Store/TestFlight publication is implied by these sources.
