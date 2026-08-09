import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SynapseX — Brain And Body, One Network",
  description:
    "SynapseX / Catena — a neural-AI interface and personal causal health twin that reasons across medication, sleep, environment, mental health and nutrition.",
  openGraph: {
    title: "SynapseX — Brain And Body, One Network",
    description:
      "A neural-AI interface that translates synaptic activity into computational intelligence.",
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
