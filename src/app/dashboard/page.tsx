import type { Metadata, Viewport } from "next";
import Script from "next/script";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Catena — Personal Causal Health Twin",
  description:
    "Catena builds a continuously-updating causal model of an individual and reasons across medication, sleep, environment, mental health and nutrition — with zero-knowledge attestations and differentially-private aggregation.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
};

/**
 * Catena dashboard shell — ported from Vaidyam public/dashboard.html.
 * All panels talk to same-origin /api/* (Next.js route handlers).
 */
export default function DashboardPage() {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"
      />
      <link rel="stylesheet" href="/static/dashboard.css" />
      <link rel="preconnect" href="https://api.open-meteo.com" crossOrigin="anonymous" />
      <link
        rel="preconnect"
        href="https://air-quality-api.open-meteo.com"
        crossOrigin="anonymous"
      />
      <link rel="preconnect" href="https://api.fda.gov" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://disease.sh" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://www.ebi.ac.uk" crossOrigin="anonymous" />
      <meta name="catena-api-base" content="/api" />

      <a className="dash-skip" href="#dash-main">
        Skip to dashboard content
      </a>

      <div id="dash-shell" className="dash-shell">
        <aside id="dash-rail" className="dash-rail" aria-label="Dashboard sections">
          <a className="rail-logo" href="/" aria-label="Back to SynapseX landing page">
            <span className="rail-logo-mark" aria-hidden="true" />
          </a>
          <nav id="rail-nav" className="rail-nav" aria-label="Views" />
          <div className="rail-foot">
            <button
              type="button"
              id="rail-refresh"
              className="rail-btn"
              aria-label="Refresh live data"
              title="Refresh live data"
            >
              <i className="bi bi-arrow-repeat" aria-hidden="true" />
            </button>
            <a
              className="rail-btn"
              href="/"
              aria-label="Exit dashboard"
              title="Exit to landing page"
            >
              <i className="bi bi-box-arrow-left" aria-hidden="true" />
            </a>
          </div>
        </aside>

        <div id="dash-scrim" className="dash-scrim" hidden />

        <div className="dash-frame">
          <header id="dash-topbar" className="dash-topbar">
            <button
              type="button"
              id="dash-menu-btn"
              className="topbar-icon-btn"
              aria-label="Open navigation"
              aria-expanded="false"
              aria-controls="dash-rail"
            >
              <i className="bi bi-list" aria-hidden="true" />
            </button>

            <div className="topbar-title">
              <p className="topbar-eyebrow" id="topbar-eyebrow">
                Catena
              </p>
              <h1 className="topbar-heading" id="topbar-heading">
                Overview
              </h1>
            </div>

            <div className="topbar-search">
              <i className="bi bi-search" aria-hidden="true" />
              <input
                type="search"
                id="graph-query-input"
                placeholder="Ask the twin — e.g. why is my sleep affecting my BP?"
                aria-label="Query the causal graph and agent swarm"
              />
            </div>

            <div className="topbar-right">
              <div className="live-chip" id="live-chip" title="Live data source status">
                <span className="live-dot" aria-hidden="true" />
                <span id="live-chip-text">connecting</span>
              </div>
              <div className="topbar-user">
                <span className="user-avatar" aria-hidden="true">
                  CT
                </span>
                <span className="user-meta">
                  <span className="user-name" id="user-name">
                    Primary Twin
                  </span>
                  <span className="user-sub" id="user-sub">
                    graph —
                  </span>
                </span>
              </div>
            </div>
          </header>

          <div id="prov-strip" className="prov-strip" aria-live="polite" />

          <main id="dash-main" className="dash-main" tabIndex={-1}>
            <div id="view-root" className="view-root" />
          </main>

          <nav id="dash-tabbar" className="dash-tabbar" aria-label="Quick views" />
        </div>
      </div>

      <div id="dash-toast" className="dash-toast" role="status" aria-live="polite" />

      {/*
        Order matters: local-engine stub first, then core, charts, views, app.
        Same-origin /api is the primary transport on this Next.js host.
      */}
      <Script src="/static/dash/local-engine.js" strategy="beforeInteractive" />
      <Script src="/static/dash/core.js" strategy="afterInteractive" />
      <Script src="/static/dash/charts.js" strategy="afterInteractive" />
      <Script src="/static/dash/views-core.js" strategy="afterInteractive" />
      <Script src="/static/dash/views-reason.js" strategy="afterInteractive" />
      <Script src="/static/dash/views-domain.js" strategy="afterInteractive" />
      <Script src="/static/dash/views-privacy.js" strategy="afterInteractive" />
      <Script src="/static/dash/app.js" strategy="afterInteractive" />
    </>
  );
}
