import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "P2P Share",
  description: "Direct peer-to-peer file sharing with WebRTC"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
