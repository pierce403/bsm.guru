import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

import { Backdrop } from "@/components/Backdrop";
import { Nav } from "@/components/Nav";

const display = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const sans = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BSM.guru",
  description:
    "Black-Scholes-Merton tooling for spotting relative value in crypto options.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${sans.variable} ${mono.variable} antialiased`}
      >
        <Backdrop />
        <Nav />
        <div className="mx-auto max-w-6xl px-6 pb-24 pt-12">{children}</div>
      </body>
    </html>
  );
}
