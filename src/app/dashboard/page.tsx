import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
 * Synchronous pre-paint boot.
 * Anchors theming on <html data-theme> + <html data-dash="1"> before first paint
 * so the shared App Router layout can never leave near-white ink on a white body
 * (the original invisible-text FOUC).
 */
const THEME_BOOT = `(function(){try{var k="catena-theme";var s=null;try{s=localStorage.getItem(k)}catch(e){}var t=(s==="light"||s==="dark")?s:((window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark");var r=document.documentElement;r.setAttribute("data-theme",t);r.setAttribute("data-dash","1");r.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?"#eef2f8":"#07080a")}catch(e){try{document.documentElement.setAttribute("data-theme","dark");document.documentElement.setAttribute("data-dash","1")}catch(_){}}})();`;

/**
 * Catena dashboard shell.
 * All panels talk to same-origin /api/* Next.js route handlers (dynamic data).
 */
export default function DashboardPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
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
          <Link className="rail-logo" href="/" aria-label="Back to SynapseX landing page">
            <span className="rail-logo-mark" aria-hidden="true" />
          </Link>
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
            <Link
              className="rail-btn"
              href="/"
              aria-label="Exit dashboard"
              title="Exit to landing page"
            >
              <i className="bi bi-box-arrow-left" aria-hidden="true" />
            </Link>
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
              <button
                type="button"
                id="theme-toggle"
                className="theme-toggle"
                aria-label="Switch theme"
                title="Switch theme"
                aria-pressed="false"
              >
                <i className="bi bi-sun-fill ic-sun" aria-hidden="true" />
                <i className="bi bi-moon-stars-fill ic-moon" aria-hidden="true" />
                <span id="theme-toggle-label" className="sr-only">
                  Dark theme active
                </span>
              </button>
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
