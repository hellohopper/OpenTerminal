# Mac Studio backend and iPhone access

Run the production web/API services on the Mac and connect the native iOS app through a private Tailscale HTTPS address. The same address works on home Wi-Fi and cellular when both devices are online in the same tailnet. Tailscale Serve exposes the authenticated web server to your tailnet; it does not publish a public Funnel or require router port forwarding.

## Files stay in this checkout

| Directory | Contents |
| --- | --- |
| `data/` | SQLite `terminal.db`, WAL files and server records |
| `config/` | `server.json`, optional APNs key, launchd plists and login launcher app |
| `logs/` | API/web output and launchd diagnostics |
| `backups/` | Scheduled business-data backups, policy and scheduler status |

These directories are ignored by Git except `config/server.example.json`. The Mac service explicitly selects local SQLite, overrides inherited database/path settings, and binds both processes to `127.0.0.1`. It never creates an application data folder or LaunchAgents file under your home directory. macOS itself retains a login-item registration pointing at the launcher inside this checkout. The iPhone retains its own device credential in its Keychain.

Existing `data/terminal.db` is reused and migrated. Existing backups under `data/backups/` are left intact; the Mac service writes new scheduled backups to `backups/`. Setup enables one daily backup at 07:00 UTC with 14-file retention. Change the schedule in the web Data panel. Device login credentials are excluded from business-data JSON backups; raw SQLite copies contain credential hashes. The owner password and signing keys are in `config/`, so protect that directory separately. Logs rotate at 5 MiB with three archives per application stream.

Keep this checkout downloaded and available to the Mac. If it lives in Dropbox, do not run a second backend against the same live SQLite files on another computer. A second independent deployment should use a separate checkout and an exported business-data backup.

## First installation

Install Node.js 22.12 or newer, dependencies (`npm ci`), and Tailscale on the Mac and phone. Sign both devices into your tailnet, enable MagicDNS/HTTPS as required by Tailscale, and read the Mac's exact `*.ts.net` DNS name from `tailscale status --json`. Use that hostname below.

From this repository:

```sh
node scripts/mac-service.mjs setup --origin https://your-mac.your-tailnet.ts.net
node scripts/mac-service.mjs credentials
node scripts/mac-service.mjs build
node scripts/mac-service.mjs install
node scripts/mac-service.mjs start
node scripts/mac-service.mjs serve
node scripts/mac-service.mjs doctor
```

`setup` creates owner credentials and a mode-0600 `config/server.json`; it refuses to overwrite an existing configuration. `credentials` deliberately displays the owner password in your terminal. Do not paste its output into an issue or PR. The generated config records the absolute Node executable path so login startup does not depend on an interactive shell. If Node or the checkout moves, update the path and rerun `install`.

`install` registers a login item and may trigger macOS System Events permission. It generates launchd configuration inside `config/`; `start` loads those files for the current logged-in user. Services restart after a crash and start after login. The API wrapper runs `caffeinate` while active unless `keepAwake` is false. A FileVault-protected reboot still requires an unlock/login before this user service and encrypted checkout are available.

`serve` checks that the configured HTTPS origin matches this running Tailscale node and refuses to replace an existing Serve configuration. If a route already exists, inspect `tailscale serve status` and reconcile it explicitly. The default CLI path is `/usr/local/bin/tailscale`; set `tailscale` in `config/server.json` if your installation differs. Tailscale owns its VPN state and HTTPS certificate lifecycle outside the application.

Open the configured HTTPS address in the phone's Safari first and verify you can sign in. Keep Tailscale enabled on the phone when away from home. Then follow the [native app instructions](../ios/README.md) to install the iOS app and use the same address/password. In the website, UI settings → Devices also offers a connection link that prefills the installed app's server address without including any credentials.

## Daily operation and upgrades

```sh
node scripts/mac-service.mjs status
node scripts/mac-service.mjs logs api
node scripts/mac-service.mjs logs web
node scripts/mac-service.mjs doctor
```

For an upgrade or config/password change, stop the service, update dependencies/build, then start it again:

```sh
node scripts/mac-service.mjs stop
npm ci
node scripts/mac-service.mjs build
node scripts/mac-service.mjs start
```

`start` alone does not restart an already running service. `stop` unloads this instance. `uninstall` unloads it and removes its login registration, retaining all repository files and data. It does not remove a Tailscale Serve route; inspect and manage that route with the Tailscale CLI. A checkout-specific launchd label allows separate instances to have separate registrations, but give them distinct ports and origins.

The iOS app stores a 30-day, revocable device token in Keychain when Remember this device is selected. Opening the app renews valid authorization; inactive phones must sign in again after expiry. The backend stores only token hashes. UI settings → Devices lists and revokes phones; revocation also removes that phone's native push registration. Changing either the owner password or session secret invalidates existing phone tokens after restarting both services. The app keeps saved authorization on temporary network errors, retries active refreshes with backoff, and displays the last successful refresh time. It does not save account or market responses to disk.

## Shared watchlists

On the web Watchlist panel, expand Shared watchlists, enter a name and Publish current list. Select that list as the source in any web workspace and in the phone's Watchlist picker. Shared list contents live in the Mac database and refresh on active clients. Symbol additions/removals are atomic, so simultaneous edits do not replace one another. Full-list replacement checks the current version and rejects stale writes. Up to 20 shared lists with 150 symbols each are supported.

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

In native Settings, choose Enable native notifications and grant iOS permission. This registers the phone and enables server background delivery while retaining its existing quiet hours/timezone. The existing delivery queue handles retries and removes expired registrations. Tapping a symbol notification opens native research. Web Push remains a separate optional channel with its existing VAPID settings.

The Mac must remain online and the monitor must observe a matching alert/signal before it can queue delivery. Permission, provisioning, sandbox/production alignment and actual background delivery must be verified on a physical phone. See [Apple APNs token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns) and [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

## Validation boundaries

Automated coverage exercises credential expiry/renewal/revocation, hashed storage, password changes, concurrent watchlist edits, stale replacements, APNs JWT/request construction, and repository-local service configuration. A browser test pairs a simulated phone through the production web proxy, edits its list from the web UI, and confirms revocation blocks both API reads and renewal.

Swift core tests and source type checking do not replace an iOS SDK build. Full Xcode, physical-device networking and APNs delivery require the deployment owner's signing setup. The iOS workflow is included for an Actions-enabled repository; no successful hosted build or App Store/TestFlight publication is implied by these sources.
