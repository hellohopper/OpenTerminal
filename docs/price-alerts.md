# Price alerts

Add **ALERTS** from the sidebar. Enter a symbol, choose a condition and threshold, optionally add a label, then select **Create alert**. Rules are shared across workspaces and saved in the server's SQLite database.

Supported conditions include equality:

- **Price ≥ / Price ≤** compare the latest available price with your threshold, in the instrument's quote currency. Binance crypto quotes use USDT; no currency conversion is performed.
- **Day change ≥ / Day change ≤** compare the provider's daily percentage change. Enter a negative percentage for a fall, such as `-5`.

An enabled rule fires on the first successful check that meets its condition, including when the condition was already met when you created it. It then stops until you select **Rearm**. This is a threshold check, not a requirement to observe a crossing from the opposite side. **Pause**, **Edit** and **Delete** manage rules; deleting a rule retains its trigger history.

## Monitoring and delivery

The API server checks enabled symbols approximately every 15 seconds while it is running, even when the web page is closed. **Check now** shares that cooldown and any check already in progress. Each provider request has a 10-second timeout; each monitor batch has a 20-second cancellation deadline. There can be up to 100 saved rules and 20 distinct enabled symbols.

Unavailable or invalid quotes leave rules enabled for retry. The monitor does not use the dashboard's expired cached fallback to trigger an alert. A fresh retrieval can still contain delayed or last-session market data: the history shows the provider and its observation timestamp when available, separately from the check time. Missing observation timestamps are shown as unavailable. Polling may miss brief threshold moves between samples. These alerts do not execute trades.

In-app notifications work across all workspaces, without keeping an ALERTS panel open. The browser polls saved events every five seconds and remembers its delivery cursor locally. When you reopen the page, unseen events appear in-app; history remains available in the panel. Each notification can open the relevant symbol's alerts.

Select **Enable desktop notifications** to opt in. The browser must support notifications and grant permission on localhost or HTTPS; see [Notification.requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static). Desktop delivery requires an open page and can be delayed by browser background throttling. Events from before the page opened are shown in-app rather than replayed as desktop notifications. Permission denial or desktop delivery failure leaves in-app notifications and history available. This feature does not use push notifications or send email/SMS.

Tabs share a delivery cursor and use Web Locks where available to reduce duplicate notifications. Without Web Locks or working browser storage, cross-tab deduplication is best effort. At most five recent notifications are displayed at once; the full trigger history is paginated in the panel.

## Verification

Automated tests cover inclusive thresholds, invalid values, one-shot triggering and rearming, edits/pause/delete during an in-flight check, atomic event persistence, retained history, input limits, pagination, provider errors, timeouts/signals, and rejection of expired quote fallback. Browser checks use an isolated database and deterministic provider fixtures; desktop permission and Notification API calls are simulated, without sending operating-system notifications.
