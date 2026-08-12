import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaidyam — The AI That Sees Why You're Sick Before You Do",
  description:
    "Vaidyam grows a living causal graph of you — medication, sleep, air you breathe, mood, food — reasoned over by a free multi-agent AI swarm in under a second, and provable to insurers, employers and doctors with zero-knowledge proofs, without your raw data ever leaving your twin.",
  openGraph: {
    title: "Vaidyam — The AI That Sees Why You're Sick Before You Do",
    description:
      "Draft-verify speculative inference, multi-agent swarm consensus and zero-knowledge privacy — near-instant, near-large-model health reasoning at zero cost per query.",
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
