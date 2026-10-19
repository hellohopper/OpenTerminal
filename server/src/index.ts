import {optionPositionsRouter} from "./routes/option-positions.js";
import {portfolioGuardsRouter} from "./routes/portfolio-guards.js";
import {guardMonitor} from "./guard-monitor.js";
import {accountImportRouter} from "./routes/account-import.js";
import {thesisMonitorRouter} from "./routes/thesis-monitor.js";
import {thesisMonitor} from "./thesis-monitor.js";
import {peersRouter} from "./routes/peers.js";
import {researchSearchRouter} from "./routes/research-search.js";
import {researchHubRouter} from "./routes/research-hub.js";
import {earningsReviewRouter} from "./routes/earnings-review.js";
import {filingReaderRouter} from "./routes/filing-reader.js";
import {consolidatedLedgerRouter} from "./routes/consolidated-ledger.js";
import {paperRouter} from "./routes/paper-trading.js";
import {paperMonitor} from "./paper-monitor.js";
import {portfolioRiskRouter} from "./routes/portfolio-risk.js";
import {valuationLabRouter} from "./routes/valuation-lab.js";
import {historyLibraryRouter} from "./routes/history-library.js";
import {todayRouter} from "./routes/today.js";
import {backtestsRouter} from "./routes/backtests.js";
import {screenerTrackingRouter} from "./routes/screener-tracking.js";
import {screenerTracker} from "./screener-tracking.js";
import {notificationsRouter} from "./routes/notifications.js";
import {notificationWorker} from "./notifications.js";
import {filingsRouter} from "./routes/filings.js";
import {filingMonitor} from "./filings.js";
import {rebalanceRouter} from "./routes/rebalance.js";
import {tradeReviewsRouter} from "./routes/trade-reviews.js";
import {thesesRouter} from "./routes/theses.js";
import {signalsRouter} from "./routes/signals.js";
import {signalMonitor} from "./signals.js";
import {holdingEventsRouter} from "./routes/holding-events.js";
import {deliveryRouter,briefingScheduler} from "./routes/delivery.js";
import {syncRouter} from "./routes/sync.js";
import {dataRouter} from "./routes/data.js";
import {tradeCsvRouter} from "./routes/trade-csv.js";
import express, { type ErrorRequestHandler } from "express";
import { db } from "./db.js";
import cors from "cors";
import { alertsRouter } from "./routes/alerts.js";
import { alertMonitor } from "./alerts.js";
import { briefingsRouter } from "./routes/briefings.js";
import { journalRouter } from "./routes/journal.js";
import { marketRouter } from "./routes/market.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { aiRouter } from "./routes/ai.js";
import { allStats } from "./providers/registry.js";
import { requireApiKey } from "./auth.js";
import { rateLimit } from "./rateLimit.js";

const app = express();

// Off by default: req.ip then falls back to the immediate socket address
// (the bundled web proxy's own address when called through it), so every
// caller behind that proxy shares one rate-limit bucket — safe, if coarser
// than per-browser. Only set TRUST_PROXY=1 if you know exactly one trusted
// reverse proxy sits in front of this process (the bundled web proxy alone,
// or your own proxy in front of it that itself sets X-Forwarded-For from
// the real client and doesn't let callers inject their own value) —
// otherwise a caller can forge X-Forwarded-For to dodge the rate limit.
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

// Only the configured web origin may call this API from a browser. Without
// this, any website open in the same browser as the terminal could reach a
// server bound beyond localhost — cors() with no options reflects every
// origin.
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
app.use(cors({ origin: webOrigin }));
app.use(
  "/api/journal",
  requireApiKey,
  express.json({ limit: "1500kb" }),
  journalRouter,
);
app.use("/api/data",requireApiKey,express.json({limit:"34mb"}),dataRouter);
app.use("/api/portfolios/:id/import",requireApiKey,express.json({limit:"2mb"}),tradeCsvRouter);
app.use("/api/sync",requireApiKey,express.json({limit:"2300kb"}),syncRouter);
app.use("/api/history-library",requireApiKey,express.json({limit:"700kb"}),rateLimit({windowMs:60000,max:60}),historyLibraryRouter);
app.use("/api/account-import",requireApiKey,express.json({limit:"700kb"}),rateLimit({windowMs:60000,max:60}),accountImportRouter);
app.use(express.json());
app.use("/api/option-positions",requireApiKey,rateLimit({windowMs:60000,max:30}),optionPositionsRouter);
app.use("/api/portfolio-guards",requireApiKey,rateLimit({windowMs:60000,max:30}),portfolioGuardsRouter);
app.use("/api/thesis-monitor",requireApiKey,rateLimit({windowMs:60000,max:30}),thesisMonitorRouter);
app.use("/api/peers",requireApiKey,rateLimit({windowMs:60000,max:20}),peersRouter);
app.use("/api/research-search",requireApiKey,rateLimit({windowMs:60000,max:60}),researchSearchRouter);
app.use("/api/research-hub",requireApiKey,researchHubRouter);
app.use("/api/earnings-review",requireApiKey,rateLimit({windowMs:60000,max:30}),earningsReviewRouter);
app.use("/api/filing-reader",requireApiKey,rateLimit({windowMs:60000,max:30}),filingReaderRouter);
app.use("/api/consolidated",requireApiKey,rateLimit({windowMs:60000,max:60}),consolidatedLedgerRouter);
app.use("/api/paper",requireApiKey,rateLimit({windowMs:60000,max:30}),paperRouter);
app.use("/api/portfolio-risk",requireApiKey,rateLimit({windowMs:60000,max:20}),portfolioRiskRouter);
app.use("/api/valuation-lab",requireApiKey,valuationLabRouter);
app.use("/api/today",requireApiKey,rateLimit({windowMs:60000,max:30}),todayRouter);
app.use("/api/backtests",requireApiKey,rateLimit({windowMs:60000,max:20}),backtestsRouter);
app.use("/api/screener-tracking",requireApiKey,rateLimit({windowMs:60000,max:30}),screenerTrackingRouter);
app.use("/api/notifications",requireApiKey,rateLimit({windowMs:60000,max:30}),notificationsRouter);
app.use("/api/filings",requireApiKey,rateLimit({windowMs:60000,max:30}),filingsRouter);
app.use("/api/rebalance",requireApiKey,rateLimit({windowMs:60000,max:20}),rebalanceRouter);
app.use("/api/trade-reviews",requireApiKey,tradeReviewsRouter);
app.use("/api/theses",requireApiKey,thesesRouter);
app.use("/api/signals",requireApiKey,rateLimit({windowMs:60000,max:30}),signalsRouter);
app.use("/api/delivery",requireApiKey,rateLimit({windowMs:60000,max:20}),deliveryRouter);
app.use("/api/holding-events",requireApiKey,rateLimit({windowMs:60000,max:30}),holdingEventsRouter);
app.use("/api/alerts", requireApiKey, alertsRouter);
app.use(
  "/api/briefings",
  requireApiKey,
  rateLimit({ windowMs: 60000, max: 10 }),
  briefingsRouter,
);

// No API key here by design (market.ts routes proxy free, keyless public data),
// but still bounded per-IP: unlike /api/ai and /api/portfolios, an unauthenticated
// caller could otherwise repeat the multi-provider fan-out in market.ts (up to
// hundreds of outbound calls per request — see getQuotes) fast enough to get
// this deployment's IP rate-limited or banned by Nasdaq/Yahoo/Stooq/SEC.
// Portfolio data and the paid AI endpoint require a shared secret; see auth.ts.
app.use("/api/portfolios", requireApiKey, portfolioRouter);
app.use(
  "/api/ai",
  requireApiKey,
  rateLimit({ windowMs: 60_000, max: 10 }),
  aiRouter,
);

app.use("/api", rateLimit({ windowMs: 60_000, max: 240 }), marketRouter);

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    providers: allStats(),
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    database: db.kind,
  });
});

const databaseError: ErrorRequestHandler = (_error, _req, res, _next) => {
  res
    .status(503)
    .json({ error: "The request could not be completed. Please retry." });
};
app.use(databaseError);

const PORT = Number(process.env.API_PORT ?? 4000);
// Bind to localhost by default so cloning and running this never exposes an
// unauthenticated-by-default API to the network. Set API_HOST=0.0.0.0 (and
// API_KEY + WEB_ORIGIN) to intentionally expose it beyond this machine.
const HOST = process.env.API_HOST ?? "127.0.0.1";
const server = app.listen(PORT, HOST, () => {
  guardMonitor.start();
  thesisMonitor.start();
  paperMonitor.start();
  screenerTracker.start();
  notificationWorker.start();
  filingMonitor.start();
  signalMonitor.start();
  alertMonitor.start();
  briefingScheduler.start();
  console.log(`OpenTerminal API listening on http://${HOST}:${PORT}`);
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  await Promise.all([guardMonitor.stop(),thesisMonitor.stop(),alertMonitor.stop(),briefingScheduler.stop(),signalMonitor.stop(),filingMonitor.stop(),notificationWorker.stop(),screenerTracker.stop(),paperMonitor.stop()]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
  clearTimeout(deadline);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void shutdown().catch(() => process.exit(1));
  });
