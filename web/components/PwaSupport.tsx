"use client";
import { useEffect, useState } from "react";
import { useI18n } from "../lib/use-i18n";
import Modal from "./Modal";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
export default function PwaSupport() {
  const { t } = useI18n();
  const [offline, setOffline] = useState(false), [open, setOpen] = useState(false), [installed, setInstalled] = useState(false), [prompt, setPrompt] = useState<InstallPrompt | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const connection = () => setOffline(!navigator.onLine);
    connection();
    const standalone = window.matchMedia("(display-mode: standalone)");
    const checkInstalled = () => setInstalled(standalone.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    checkInstalled();
    const install = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setOpen(false); setPrompt(null); };
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    window.addEventListener("beforeinstallprompt", install); window.addEventListener("appinstalled", done);
    standalone.addEventListener("change", checkInstalled);
    if (window.isSecureContext && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => setError("Offline support could not be initialized. Reload to retry."));
    return () => { window.removeEventListener("online", connection); window.removeEventListener("offline", connection); window.removeEventListener("beforeinstallprompt", install); window.removeEventListener("appinstalled", done); standalone.removeEventListener("change", checkInstalled); };
  }, []);
  return <>
    {!installed && <button className="term-btn" onClick={() => setOpen(true)}>{t("Install app")}</button>}
    {offline && <p className="offline-banner" role="status">{t("You are offline. Quotes may be outdated; reconnect to refresh data and save server changes.")}</p>}
    {open && <Modal label={t("Install OpenTerminal")} className="install-dialog" onClose={() => setOpen(false)}><div className="p-4 space-y-4">
      <h2 className="amber text-lg">{t("Install OpenTerminal")}</h2>
      <p>{t("On iPhone or iPad: open this site in Safari, tap Share, then Add to Home Screen. Launch it from the new icon.")}</p>
      <p>{t("On desktop or Android: use your browser’s Install app option when available.")}</p>
      <p className="dim">{t("A reachable HTTPS server is required. Background alerts also require server push keys, an active API and notification permission. Offline mode does not provide live prices.")}</p>
      {error && <p role="status">{t(error)}</p>}
      {prompt && <button className="term-btn" onClick={async () => { try { await prompt.prompt(); await prompt.userChoice; setPrompt(null); } catch { setError("Installation was unavailable. Use your browser menu instead."); } }}>{t("Install now")}</button>}
      <button className="term-btn" onClick={() => setOpen(false)}>{t("Done")}</button>
    </div></Modal>}
  </>;
}
