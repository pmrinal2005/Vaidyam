/* ==========================================================================
   SynapseX — landing page behaviour
   - scroll-scrubbed background video (blur + zoom)
   - scramble-in / scramble-out hero type
   - cinematic 3D parallax paragraph
   - metrics coverflow carousel (Swiper)
   Pure client-side: no server runtime required (static hosting friendly).
   ========================================================================== */
(function () {
  "use strict";

  /* ── Constants ── */
  var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+~|}{[]:;?><";
  var NBSP = "\u00A0";

  var statsData = [
    { title: "NEURAL ACTIVITY",   value: "7.2M",  footer: "LIVE SIGNALS INTERPRETED",     details: ["Continuous temporal synapsing", "1024 parallel telemetry streams", "Dynamic feed classification active"] },
    { title: "PREDICTIVE MODEL",  value: "93%",   footer: "FORECAST ACCURACY RATE",       details: ["Reinforced gradient mapping", "Low latency neural resolution", "Adaptive signal feedback system"] },
    { title: "EPOCH LATENCY",     value: "0.4ms", footer: "CYCLE RESPONSE SPEED",         details: ["Hardware accelerated pipeline", "Direct metal shader execution", "Temporal synchronization loop"] },
    { title: "COGNITIVE STREAMS", value: "14.8M", footer: "REAL-TIME MODEL COHERENCE",    details: ["Distributed synapse projection", "High-fidelity entropy filtering", "Sub-millisecond state coherence"] },
    { title: "SYNAPSE DEPTH",     value: "128L",  footer: "MODEL RESOLUTION DEPTH",       details: ["Deep feed-forward mapping", "Transformer-based neural routing", "Multi-dimensional pattern projection"] },
    { title: "SIGNAL INTEGRITY",  value: "99.9%", footer: "NOISE REDUCTION RATIO",        details: ["Advanced wave-let filtering", "Dynamic heuristic balancing", "Contextual signal amplification"] }
  ];

  /* ── Elements ── */
  var video          = document.getElementById("bg-video");
  var header         = document.getElementById("main-header");
  var mainContent    = document.getElementById("main-content");
  var heroSection    = document.getElementById("hero-section");
  var heroDesc       = document.getElementById("hero-desc");
  var cinematicInner = document.getElementById("cinematic-inner");
  var statsSection   = document.getElementById("stats-section");
  var wrapper        = document.getElementById("swiper-wrapper");
  var footerYear     = document.getElementById("footer-year");

  var reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (footerYear) footerYear.textContent = String(new Date().getFullYear());

  /* ── State ── */
  var scrollProgress = 0;
  var smoothScrollProgress = 0;
  var entrancePhase = "loading"; // loading | animating | complete
  var entranceStart = 0;
  var videoReady = false;
  var videoUsable = true;

  /* ── Utils ── */
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* ── Build metrics cards ── */
  if (wrapper) {
    statsData.forEach(function (card) {
      var slide = document.createElement("li");
      slide.className = "swiper-slide";
      slide.innerHTML =
        '<article class="stat-card-outer">' +
          '<div class="stat-card-inner">' +
            '<div class="stat-body">' +
              '<div class="stat-head"><h3 class="stat-title">' + escapeHtml(card.title) + '</h3></div>' +
              '<p class="stat-value">' + escapeHtml(card.value) + '</p>' +
            '</div>' +
            '<ul class="stat-details">' +
              card.details.map(function (d) {
                return '<li class="stat-detail"><span class="dot" aria-hidden="true"></span><span>' + escapeHtml(d) + '</span></li>';
              }).join("") +
            '</ul>' +
          '</div>' +
          '<p class="stat-footer">' + escapeHtml(card.footer) + '</p>' +
        '</article>';
      wrapper.appendChild(slide);
    });
  }

  /* ── Swiper init (guarded: CDN may be blocked) ── */
  if (typeof window.Swiper === "function") {
    try {
      new window.Swiper("#stats-swiper", {
        effect: "coverflow",
        grabCursor: true,
        slidesPerView: "auto",
        centeredSlides: true,
        loop: true,
        spaceBetween: 32,
        coverflowEffect: { rotate: 30, stretch: 0, depth: 100, modifier: 1, slideShadows: false },
        observer: true,
        observeParents: true,
        a11y: { enabled: true }
      });
    } catch (err) {
      /* carousel degrades to a horizontal list */
    }
  }

  /* ── Smooth scrolling engine (Lenis on desktop) ── */
  var lenisInstance = null;
  var isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768;

  function scrollToTarget(target) {
    if (lenisInstance) {
      lenisInstance.scrollTo(target, { offset: -80 });
      return;
    }
    if (typeof target === "number") {
      window.scrollTo({ top: target, behavior: reduceMotion ? "auto" : "smooth" });
    } else if (target && target.getBoundingClientRect) {
      var top = target.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  if (!isMobile && !reduceMotion) {
    var lenisScript = document.createElement("script");
    lenisScript.src = "https://unpkg.com/lenis@1.1.18/dist/lenis.min.js";
    lenisScript.onload = function () {
      if (typeof window.Lenis !== "function") return;
      lenisInstance = new window.Lenis({
        duration: 1.2,
        easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        smoothWheel: true,
        wheelMultiplier: 1.0,
        touchMultiplier: 1.5
      });
      lenisInstance.on("scroll", onScroll);
      (function raf(time) {
        lenisInstance.raf(time);
        requestAnimationFrame(raf);
      })(performance.now());
    };
    document.head.appendChild(lenisScript);
  }

  /* ── Scroll tracking ── */
  function updateScrollProgress() {
    var doc = document.documentElement;
    var scrollTop = window.scrollY || doc.scrollTop || 0;
    var scrollHeight = doc.scrollHeight - doc.clientHeight;
    scrollProgress = scrollHeight > 0 ? clamp01(scrollTop / scrollHeight) : 0;
  }

  function onScroll() {
    updateScrollProgress();
    checkStatsReveal();
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  window.addEventListener("orientationchange", onScroll, { passive: true });
  updateScrollProgress();

  /* ── Navigation: pills, hamburgers, anchors ── */
  var menuPill      = document.getElementById("menu-pill");
  var menuPillM     = document.getElementById("menu-pill-m");
  var logoPillM     = document.getElementById("logo-pill-m");
  var hamburgerBtn  = document.getElementById("hamburger-btn");
  var hamburgerBtnM = document.getElementById("hamburger-btn-m");

  function closeDesktopMenu() {
    if (!menuPill) return;
    menuPill.classList.remove("open");
    if (hamburgerBtn) hamburgerBtn.setAttribute("aria-expanded", "false");
  }
  function closeMobileMenu() {
    if (!menuPillM) return;
    menuPillM.classList.remove("open");
    if (logoPillM) logoPillM.classList.remove("collapsed");
    if (hamburgerBtnM) hamburgerBtnM.setAttribute("aria-expanded", "false");
  }

  if (hamburgerBtn && menuPill) {
    hamburgerBtn.addEventListener("click", function () {
      var open = menuPill.classList.toggle("open");
      hamburgerBtn.setAttribute("aria-expanded", String(open));
    });
  }
  if (hamburgerBtnM && menuPillM) {
    hamburgerBtnM.addEventListener("click", function () {
      var open = menuPillM.classList.toggle("open");
      if (logoPillM) logoPillM.classList.toggle("collapsed", open);
      hamburgerBtnM.setAttribute("aria-expanded", String(open));
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-nav-link]"), function (link) {
    link.addEventListener("click", function (evt) {
      var id = (link.getAttribute("href") || "").replace("#", "");
      var target = id ? document.getElementById(id) : null;
      if (target) {
        evt.preventDefault();
        scrollToTarget(target);
      }
      closeDesktopMenu();
      closeMobileMenu();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-scroll-top]"), function (btn) {
    btn.addEventListener("click", function () {
      scrollToTarget(0);
      closeDesktopMenu();
      closeMobileMenu();
    });
  });

  document.addEventListener("keydown", function (evt) {
    if (evt.key === "Escape") { closeDesktopMenu(); closeMobileMenu(); }
  });

  /* ── Scramble-in / scramble-out engine ── */
  var scrambleStates = [];
  Array.prototype.forEach.call(document.querySelectorAll("[data-scramble-in]"), function (el) {
    var text = el.getAttribute("data-text") || "";
    var delay = parseInt(el.getAttribute("data-delay") || "0", 10);
    // Reserve layout space before the animation starts.
    el.textContent = text.replace(/\S/g, NBSP);
    el.style.opacity = "0";
    scrambleStates.push({
      el: el, text: text, delay: delay,
      phase: "idle", // idle | scrambling-in | revealed | scrambling-out | hidden
      progress: 0, lastTime: 0, started: false
    });
  });

  if (reduceMotion) {
    scrambleStates.forEach(function (s) {
      s.phase = "revealed";
      s.el.textContent = s.text;
      s.el.style.opacity = "1";
    });
  }

  function updateScrambles(now) {
    if (reduceMotion) return;
    var scrollActive = scrollProgress > 0.015;

    scrambleStates.forEach(function (s) {
      if (!videoReady && s.phase === "idle") return;

      if (videoReady && s.phase === "idle" && !scrollActive && !s.started) {
        s.started = true;
        setTimeout(function () {
          s.phase = "scrambling-in";
          s.progress = 0;
          s.lastTime = performance.now();
        }, s.delay);
        return;
      }

      if (scrollActive && (s.phase === "revealed" || s.phase === "scrambling-in")) {
        s.phase = "scrambling-out"; s.progress = 0; s.lastTime = now;
      } else if (!scrollActive && (s.phase === "hidden" || s.phase === "scrambling-out")) {
        s.phase = "scrambling-in"; s.progress = 0; s.lastTime = now;
      }

      var i, t, threshold, result;

      if (s.phase === "scrambling-in") {
        s.progress = Math.min(1, s.progress + (now - s.lastTime) / 900);
        s.lastTime = now;
        t = s.progress;
        result = "";
        for (i = 0; i < s.text.length; i++) {
          if (s.text[i] === " ") { result += " "; continue; }
          threshold = i / s.text.length;
          if (t >= threshold + 0.15) result += s.text[i];
          else if (t >= threshold - 0.1) result += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          else result += NBSP;
        }
        s.el.textContent = result;
        s.el.style.opacity = "1";
        if (t >= 1) { s.phase = "revealed"; s.el.textContent = s.text; }

      } else if (s.phase === "scrambling-out") {
        s.progress = Math.min(1, s.progress + (now - s.lastTime) / 700);
        s.lastTime = now;
        t = s.progress;
        result = "";
        for (i = 0; i < s.text.length; i++) {
          if (s.text[i] === " ") { result += " "; continue; }
          threshold = i / s.text.length;
          if (t >= threshold + 0.2) result += NBSP;
          else if (t >= threshold - 0.05) result += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          else result += s.text[i];
        }
        s.el.textContent = result;
        s.el.style.opacity = String(Math.max(0, 1 - t * 1.5));
        if (t >= 1) {
          s.phase = "hidden";
          s.el.textContent = s.text.replace(/\S/g, NBSP);
          s.el.style.opacity = "0";
        }
      }
    });
  }

  /* ── Metrics reveal on scroll ── */
  var statsRevealed = false;
  function checkStatsReveal() {
    if (statsRevealed || !statsSection) return;
    var rect = statsSection.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) {
      statsRevealed = true;
      statsSection.classList.add("revealed");
    }
  }

  /* ── Video scrub plumbing ── */
  var isSeeking = false;
  var nextSeekTime = null;

  function revealChrome() {
    if (videoReady) return;
    videoReady = true;
    if (header) header.classList.add("visible");
    if (mainContent) mainContent.classList.add("visible");
  }

  if (video) {
    video.autoplay = false;
    video.pause();

    video.addEventListener("seeking", function () { isSeeking = true; });
    video.addEventListener("seeked", function () {
      isSeeking = false;
      if (nextSeekTime !== null) {
        var t = nextSeekTime;
        nextSeekTime = null;
        if (video.readyState >= 1 && video.duration > 0) { isSeeking = true; video.currentTime = t; }
      }
    });
    video.addEventListener("loadedmetadata", function () { video.autoplay = false; video.pause(); });
    video.addEventListener("error", function () {
      // Network/codec failure: keep the page fully usable on a black canvas.
      videoUsable = false;
      entrancePhase = "complete";
      revealChrome();
    });
  } else {
    videoUsable = false;
    entrancePhase = "complete";
  }

  if (reduceMotion || !videoUsable) {
    entrancePhase = "complete";
    revealChrome();
  }

  // Safety net: never leave the page hidden if the video never buffers.
  setTimeout(function () {
    if (entrancePhase === "loading") {
      entrancePhase = "animating";
      entranceStart = performance.now();
    }
  }, 3500);

  /* ── Main animation loop ── */
  function tick(now) {
    /* Smooth scroll interpolation */
    smoothScrollProgress += (scrollProgress - smoothScrollProgress) * 0.12;
    if (Math.abs(scrollProgress - smoothScrollProgress) < 0.0001) smoothScrollProgress = scrollProgress;

    if (video && videoUsable && !reduceMotion) {
      /* Blur + scale driven by scroll */
      var subtleBase  = clamp01((smoothScrollProgress - 0.1) / 0.45);
      var progressive = clamp01((smoothScrollProgress - 0.55) / 0.4);
      var blurVal  = subtleBase * 5 + progressive * 50;
      var scaleVal = 1.03 + clamp01((smoothScrollProgress - 0.1) / 0.9) * 0.08;

      /* Entrance */
      var entranceZoom = 1.0;
      var entranceOpacity = 1.0;

      if (entrancePhase === "loading") {
        entranceZoom = 1.12;
        entranceOpacity = 0;
        if (video.readyState >= 3) {
          entrancePhase = "animating";
          entranceStart = now;
        }
      }

      if (entrancePhase === "animating") {
        var elapsed = now - entranceStart;
        var progress = Math.min(1, elapsed / 1400);
        var easeOut = 1 - Math.pow(1 - progress, 3);
        entranceZoom = 1.12 - 0.12 * easeOut;
        entranceOpacity = Math.min(1.0, elapsed / 500);
        if (progress >= 1) { entrancePhase = "complete"; revealChrome(); }
      }

      if (entrancePhase === "complete") revealChrome();

      video.style.filter = "blur(" + blurVal + "px)";
      video.style.transform = "scale(" + (scaleVal * entranceZoom) + ")";
      video.style.opacity = String(entranceOpacity);

      /* Scroll-driven seek */
      if (video.readyState >= 1 && video.duration > 0 && isFinite(video.duration)) {
        var targetTime = Math.max(0, Math.min(video.duration, smoothScrollProgress * video.duration));
        if (Math.abs(video.currentTime - targetTime) > 0.008) {
          if (!isSeeking && !video.seeking) { isSeeking = true; video.currentTime = targetTime; }
          else { nextSeekTime = targetTime; }
        }
      }
    }

    if (!reduceMotion) {
      var doc = document.documentElement;
      var scrollH = doc.scrollHeight - doc.clientHeight;
      var scrollYNorm = scrollH > 0 ? clamp01(window.scrollY / scrollH) : 0;

      /* Hero fade + subtle scale */
      if (heroSection) {
        heroSection.style.opacity = String(clamp01(1 - scrollYNorm / 0.26));
        heroSection.style.transform = "scale(" + (1 - 0.04 * Math.min(1, scrollYNorm / 0.26)) + ")";
      }

      /* Hero description fade */
      if (heroDesc && heroDesc._entered) {
        heroDesc.style.opacity = String(clamp01(1 - scrollYNorm / 0.12));
        heroDesc.style.transform = "translateY(" + (-30 * Math.min(1, scrollYNorm / 0.12)) + "px)";
      }

      /* Cinematic paragraph: 3D parallax + opacity keyframes */
      if (cinematicInner) {
        var yVal = -120 * Math.min(1, window.scrollY / 1000);
        var cinOp;
        if (scrollYNorm <= 0.08) cinOp = 0;
        else if (scrollYNorm <= 0.22) cinOp = (scrollYNorm - 0.08) / 0.14;
        else if (scrollYNorm <= 0.42) cinOp = 1;
        else if (scrollYNorm <= 0.65) cinOp = 1 - (scrollYNorm - 0.42) / 0.23;
        else cinOp = 0;
        cinematicInner.style.transform = "rotateX(24deg) translateY(" + yVal + "px) translateZ(15px)";
        cinematicInner.style.opacity = String(clamp01(cinOp));
      }

      updateScrambles(now);

      /* Hero description entrance (once) */
      if (videoReady && heroDesc && !heroDesc._entered) {
        heroDesc._entered = true;
        heroDesc.style.transition =
          "opacity 0.9s cubic-bezier(0.215,0.61,0.355,1) 0.2s, transform 0.9s cubic-bezier(0.215,0.61,0.355,1) 0.2s";
        heroDesc.style.opacity = "1";
        heroDesc.style.transform = "translateY(0)";
      }
    }

    requestAnimationFrame(tick);
  }

  /* Initial description state */
  if (heroDesc && !reduceMotion) {
    heroDesc.style.opacity = "0";
    heroDesc.style.transform = "translateY(25px)";
  }

  requestAnimationFrame(tick);
  checkStatsReveal();
})();
