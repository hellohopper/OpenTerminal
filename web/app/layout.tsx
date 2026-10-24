import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "OpenTerminal",
  description: "Bloomberg-style financial terminal on free data sources",
  appleWebApp: { capable: true, title: "OpenTerminal", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#111827" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
