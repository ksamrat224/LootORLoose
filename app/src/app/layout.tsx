import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope, Silkscreen } from "next/font/google";
import "./globals.css";
import "./quests.css";
import "./hunt-dashboard.css";
import { WalletProviders } from "@/lib/WalletProviders";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-hunt-body",
  subsets: ["latin"],
  display: "swap",
});
const silkscreen = Silkscreen({
  variable: "--font-hunt-display",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Loot or Lose",
  description: "A verifiable dungeon extraction game on Solana.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${silkscreen.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <WalletProviders>{children}</WalletProviders>
      </body>
    </html>
  );
}
