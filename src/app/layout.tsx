import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Catena — Your Personal Causal Health Twin, Reasoning at Zero Cost",
  description:
    "Catena builds a continuously-updating causal knowledge graph of you — medication, sleep, environment, mental health and nutrition — reasoned over by a free-tier multi-agent AI swarm, and provable to insurers, employers and clinicians with zero-knowledge attestations, without ever exposing your raw data.",
  openGraph: {
    title: "Catena — Your Personal Causal Health Twin, Reasoning at Zero Cost",
    description:
      "Draft-verify speculative inference, multi-agent swarm consensus and zero-knowledge privacy — near-large-model reasoning at near-zero cost and near-zero latency.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
