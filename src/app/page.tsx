import Script from "next/script";
import RevealStage from "@/components/reveal/RevealStage";

export const dynamic = "force-static";

export default function HomePage() {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap"
        rel="stylesheet"
      />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"
      />
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css"
      />
      <link rel="stylesheet" href="/static/styles.css" />
      <link rel="stylesheet" href="/static/reveal/reveal.css" />
      <link rel="stylesheet" href="/static/reveal/index.css" />

      {/* Shared SVG symbols */}
      <svg
        aria-hidden="true"
        focusable="false"
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      >
        <defs>
          <symbol id="logo-mark" viewBox="-50 -50 100 100">
            <g fill="currentColor">
              <path d="M 1.5,23 L 1.5,33 C 1.5,38.5 6,43 11.5,43 L 16.5,43 C 22,43 26.5,38.5 26.5,33 Q 28,28 33,26.5 C 38.5,26.5 43,22 43,16.5 L 43,11.5 C 43,6 38.5,1.5 33,1.5 L 23,1.5 Q 12,12 1.5,23 Z" />
              <path
                d="M 1.5,23 L 1.5,33 C 1.5,38.5 6,43 11.5,43 L 16.5,43 C 22,43 26.5,38.5 26.5,33 Q 28,28 33,26.5 C 38.5,26.5 43,22 43,16.5 L 43,11.5 C 43,6 38.5,1.5 33,1.5 L 23,1.5 Q 12,12 1.5,23 Z"
                transform="rotate(90)"
              />
              <path
                d="M 1.5,23 L 1.5,33 C 1.5,38.5 6,43 11.5,43 L 16.5,43 C 22,43 26.5,38.5 26.5,33 Q 28,28 33,26.5 C 38.5,26.5 43,22 43,16.5 L 43,11.5 C 43,6 38.5,1.5 33,1.5 L 23,1.5 Q 12,12 1.5,23 Z"
                transform="rotate(180)"
              />
              <path
                d="M 1.5,23 L 1.5,33 C 1.5,38.5 6,43 11.5,43 L 16.5,43 C 22,43 26.5,38.5 26.5,33 Q 28,28 33,26.5 C 38.5,26.5 43,22 43,16.5 L 43,11.5 C 43,6 38.5,1.5 33,1.5 L 23,1.5 Q 12,12 1.5,23 Z"
                transform="rotate(270)"
              />
            </g>
          </symbol>
        </defs>
      </svg>

      <a className="skip-link" href="#hero-section">
        Skip to content
      </a>

      <div id="video-layer" aria-hidden="true">
        <video
          id="bg-video"
          loop
          muted
          playsInline
          preload="auto"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_39ca84eAE1ODL9hbR5VhoEj8tBf/hf_20260613_120544_a609e0c2-e52d-4bd5-b10f-b66ac51f1965.mp4"
        />
      </div>

      <div id="bottom-blur" aria-hidden="true" />

      <header id="main-header">
        <div className="desktop-header">
          <div className="header-left">
            <button
              type="button"
              className="logo-pill"
              id="logo-pill"
              data-scroll-top
              aria-label="SynapseX — back to top"
            >
              <svg aria-hidden="true" focusable="false">
                <use href="#logo-mark" />
              </svg>
              <span>SynapseX</span>
            </button>

            <nav className="menu-pill" id="menu-pill" aria-label="Primary">
              <button
                type="button"
                className="hamburger-btn"
                id="hamburger-btn"
                aria-label="Toggle menu"
                aria-expanded="false"
                aria-controls="menu-links"
              >
                <span className="hamburger-icon" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>
              <div className="menu-links" id="menu-links">
                <a href="#cinematic-section" data-nav-link>
                  About
                </a>
                <a href="#stats-section" data-nav-link>
                  Metrics
                </a>
              </div>
            </nav>
          </div>

          <a
            className="download-btn"
            id="download-btn"
            href="/dashboard"
            data-enter-dashboard
            aria-label="Open the Catena causal health dashboard"
          >
            <i className="bi bi-apple" aria-hidden="true" />
            <span>Download</span>
          </a>
        </div>

        <div className="mobile-header">
          <div className="mobile-left">
            <button
              type="button"
              className="logo-pill-m"
              id="logo-pill-m"
              data-scroll-top
              aria-label="SynapseX — back to top"
            >
              <svg aria-hidden="true" focusable="false">
                <use href="#logo-mark" />
              </svg>
              <span>SynapseX</span>
            </button>

            <nav className="menu-pill-m" id="menu-pill-m" aria-label="Primary mobile">
              <button
                type="button"
                className="hamburger-btn-m"
                id="hamburger-btn-m"
                aria-label="Toggle menu"
                aria-expanded="false"
                aria-controls="menu-links-m"
              >
                <span className="hamburger-icon-m" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>
              <div className="menu-links-m" id="menu-links-m">
                <a href="#cinematic-section" data-nav-link>
                  About
                </a>
                <a href="#stats-section" data-nav-link>
                  Metrics
                </a>
              </div>
            </nav>
          </div>

          <a
            className="download-btn-m"
            id="download-btn-m"
            href="/dashboard"
            data-enter-dashboard
            aria-label="Open the Catena causal health dashboard"
          >
            <i className="bi bi-apple" aria-hidden="true" />
            <span>Download</span>
          </a>
        </div>
      </header>

      <main id="main-content">
        <div className="dot-grid" aria-hidden="true" />

        <section id="hero-section" aria-labelledby="hero-heading">
          <div className="hero-stack">
            <div className="hero-grid">
              <div className="hero-col-left">
                <h1 className="hero-title" id="hero-heading">
                  <span className="visually-hidden">Brain And Body</span>
                  <span
                    className="scramble-line"
                    data-scramble-in
                    data-text="Brain"
                    data-delay="100"
                    aria-hidden="true"
                  />
                  <span
                    className="scramble-line"
                    data-scramble-in
                    data-text="And Body"
                    data-delay="300"
                    aria-hidden="true"
                  />
                </h1>
              </div>
              <div className="hero-col-spacer" aria-hidden="true" />
            </div>

            <div className="hero-grid-bottom">
              <p className="hero-desc" id="hero-desc">
                Built at the intersection of neuroscience and artificial intelligence. SynapseX
                continuously maps neural pathways, cognitive load, and physiological states into a
                single adaptive intelligence layer.
              </p>
              <div className="hero-col-right">
                <p className="visually-hidden">One Network</p>
                <p className="hero-title right" aria-hidden="true">
                  <span
                    className="scramble-line"
                    data-scramble-in
                    data-text="One"
                    data-delay="200"
                  />
                  <span
                    className="scramble-line"
                    data-scramble-in
                    data-text="Network"
                    data-delay="400"
                  />
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="cinematic-section" aria-labelledby="cinematic-heading">
          <div id="cinematic-inner">
            <h2 id="cinematic-heading">
              A neural-AI interface built on the architecture of the human nervous system. SynapseX
              translates synaptic activity into computational intelligence. Every signal becomes
              measurable, structured, and visible. It continuously reconstructs internal state as a
              dynamic neural map. Biological noise is filtered into actionable cognitive patterns.
            </h2>
          </div>
        </section>

        <section id="stats-section" aria-labelledby="stats-heading">
          <h2 id="stats-heading" className="visually-hidden">
            System metrics
          </h2>
          <div className="swiper" id="stats-swiper">
            <ul className="swiper-wrapper" id="swiper-wrapper" />
          </div>
        </section>
      </main>

      <section id="reveal-section" aria-labelledby="reveal-heading">
        <h2 id="reveal-heading" className="visually-hidden">
          Master the Elements — 2K26 collection reveal
        </h2>
        <div id="reveal-root" data-mounted="true">
          <RevealStage />
        </div>
      </section>

      <footer id="main-footer">
        <p>SynapseX — Neural Intelligence Layer</p>
        <p>
          <span id="footer-year" /> · All signals reserved
        </p>
      </footer>

      <Script
        src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"
        strategy="beforeInteractive"
      />
      <Script src="/static/app.js" strategy="afterInteractive" />
    </>
  );
}
