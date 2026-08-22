import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaUpdater from "./pwa-updater";

export const metadata: Metadata = {
  metadataBase: new URL("https://control-inventario-negocio.messi020306.chatgpt.site"),
  title: "CIV — Control de Inventario y Ventas",
  description: "Inventario, movimientos, clientes y notas de crédito en un solo lugar.",
  applicationName: "CIV",
  other: {
    "codex-preview": "development",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CIV",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "CIV — Control de Inventario y Ventas",
    description: "Inventario, movimientos, clientes y notas de crédito en un solo lugar.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "CIV — Control de Inventario y Ventas" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CIV — Control de Inventario y Ventas",
    description: "Inventario, movimientos, clientes y notas de crédito en un solo lugar.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101b2e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}<PwaUpdater /></body>
    </html>
  );
}
