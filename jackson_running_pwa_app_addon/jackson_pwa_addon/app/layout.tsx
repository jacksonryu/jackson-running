import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "./pwa-register";

const BASE_PATH = "/jackson-running";

export const metadata: Metadata = {
  title: "JACKSON RUNNING ENGINE",
  description: "Personal running analytics, training and coaching dashboard",
  applicationName: "JACKSON RUNNING ENGINE",
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: {
    icon: [
      { url: `${BASE_PATH}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${BASE_PATH}/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: `${BASE_PATH}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "JACKSON RUNNING",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050505",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full bg-black">
      <body className="min-h-full bg-black">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
