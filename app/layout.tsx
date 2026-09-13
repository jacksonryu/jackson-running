import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JACKSON RUNNING ENGINE",
  description: "Personal running analytics and coaching dashboard",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full bg-black">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
