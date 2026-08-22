/* Views: Casual — a gamified, story-driven lens on the SAME causal twin.
 *
 * This view reads the SAME /api/overview envelope as the Pro "Twin Overview"
 * (plus the additive `gamification` block) and the /checkin endpoint. It never
 * replaces the Pro view: every card offers "Expand" that deep-links to the
 * original Pro panels (overview/graph/counterfactual/medication/environment/
 * privacy). Casual is a beautiful lens; no information is lost.
 */
(function () {
  "use strict";
  var C = (window.Vaidyam = window.Vaidyam || {});
  var V = (C.views = C.views || {});
  var Ch = C.chart;

  /* Aura hue name → gradient stops for the living-twin avatar. */
  function auraColors(aura) {
    return {
      amber: [C.hue("amber"), C.hue("orange")],
      blue: [C.hue("blue"), C.hue("cyan")],
      mint: [C.hue("mint"), C.hue("blue")],
      violet: [C.hue("violet"), C.hue("rose")]
    }[aura] || [C.hue("mint"), C.hue("blue")];
  }

  /* Living-twin avatar: an interactive, lightweight 3D sphere (WebGL via
     Three.js, CDN-loaded) with stylized eyes + lips on the front face that
     dynamically follow the user's cursor. Keeps the original neon-glow aura /
     colour scheme (breathing rate + hue reflect integrity, AQI and top risk).
     A pure-CSS orb is rendered underneath as an instant, zero-dependency
     fallback for reduced-motion, WebGL-less, or slow-to-load environments. */
  function avatar(level, air, topRisk) {
    var cols = auraColors(level.aura);
    var breath = air && air.aqi > 150 ? "3.4s" : air && air.aqi > 100 ? "4.2s" : "6s";
    var riskPulse = topRisk && topRisk.score >= 62 ? "twin-risk-hot" : "";
    // Stash the live avatar params so the deferred 3D init (in `after`) can read
    // the current aura colours / breathing cadence without re-plumbing them.
    C._twinAvatar = {
      a1: cols[0], a2: cols[1],
      breath: parseFloat(breath) || 6,
      hot: !!(topRisk && topRisk.score >= 62),
      integrity: level.integrity != null ? level.integrity : 60
    };
    return (
      '<div class="twin-avatar ' + riskPulse + '" style="--a1:' + cols[0] + ';--a2:' + cols[1] + ';--breath:' + breath + '">' +
      // 3D canvas mount — filled in by initTwin3D(); labelled for a11y.
      '<div id="twin-3d" class="twin-3d" role="img" aria-label="Interactive 3D health-twin avatar whose eyes follow your cursor"></div>' +
      // CSS-orb fallback (also the instant first paint before WebGL is ready).
      '<div class="twin-orb twin-orb-fallback" aria-hidden="true"><div class="twin-orb-core"></div><div class="twin-orb-ring"></div><div class="twin-orb-ring r2"></div></div>' +
      '<div class="twin-particles" aria-hidden="true">' +
      Array.apply(null, Array(10)).map(function (_, i) {
        return '<span class="tp tp' + i + '"></span>';
      }).join("") +
      "</div></div>"
    );
  }

  /* ── Lazy CDN script loader (cached; resolves once) ── */
  var _scriptCache = {};
  function loadScript(src) {
    if (_scriptCache[src]) return _scriptCache[src];
    _scriptCache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("failed to load " + src)); };
      document.head.appendChild(s);
    });
    return _scriptCache[src];
  }

  var THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";

  /* ══════════════ Interactive 3D twin sphere ══════════════
     Lightweight: one low-poly sphere + a few tiny meshes for eyes/lips, no
     textures, no post-processing, capped DPR, pauses when off-screen/tab hidden
     so it stays friendly on low-resource hardware. Eyes track the cursor. */
  function initTwin3D() {
    var mount = C.$("#twin-3d");
    if (!mount) return;
    // Respect reduced-motion + prior failures: keep the CSS fallback only.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (C._twin3DFailed) return;

    loadScript(THREE_CDN).then(function () {
      var THREE = window.THREE;
      if (!THREE || !C.$("#twin-3d")) return;
      try { buildTwinScene(THREE, C.$("#twin-3d")); }
      catch (e) { C._twin3DFailed = true; /* CSS fallback remains visible */ }
    }).catch(function () { C._twin3DFailed = true; });
  }

  function hexToColor(THREE, hex) {
    try { return new THREE.Color(hex); } catch (e) { return new THREE.Color("#7cf5c4"); }
  }

  function buildTwinScene(THREE, mount) {
    // Tear down any previous instance (view re-renders on every check-in).
    if (C._twinTeardown) { try { C._twinTeardown(); } catch (e) {} C._twinTeardown = null; }
    mount.innerHTML = "";

    var params = C._twinAvatar || { a1: "#7cf5c4", a2: "#6ee7f5", breath: 6, hot: false, integrity: 60 };
    var col1 = hexToColor(THREE, params.a1);
    var col2 = hexToColor(THREE, params.a2);

    var W = mount.clientWidth || 150, H = mount.clientHeight || 150;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    camera.position.set(0, 0, 6);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); // cap DPR for low-end GPUs
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    // Root group so the whole twin (body + face) breathes / reacts together.
    var twin = new THREE.Group();
    scene.add(twin);

    // ── Glowing body sphere (neon aura) — low poly, cheap ──
    var bodyGeo = new THREE.SphereGeometry(1.5, 32, 24);
    var bodyMat = new THREE.MeshStandardMaterial({
      color: col1, emissive: col1.clone().multiplyScalar(0.55),
      roughness: 0.32, metalness: 0.12, transparent: true, opacity: 0.96
    });
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    twin.add(body);

    // Soft outer glow shell (additive, back-side) for the neon halo.
    var glowGeo = new THREE.SphereGeometry(1.72, 24, 18);
    var glowMat = new THREE.MeshBasicMaterial({
      color: col2, transparent: true, opacity: 0.16,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    twin.add(new THREE.Mesh(glowGeo, glowMat));

    // ── Face group (eyes + lips) sits on the front of the sphere ──
    var face = new THREE.Group();
    twin.add(face);

    var eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fb8c9, emissiveIntensity: 0.35, roughness: 0.25 });
    var pupilMat = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.2, metalness: 0.1 });

    function makeEye(x) {
      var g = new THREE.Group();
      var white = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), eyeWhiteMat);
      white.scale.set(1, 1.15, 0.6);
      var pupil = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), pupilMat);
      pupil.position.set(0, 0, 0.26);
      g.add(white); g.add(pupil);
      g.position.set(x, 0.42, 1.32);
      g._pupil = pupil;
      face.add(g);
      return g;
    }
    var leftEye = makeEye(-0.5);
    var rightEye = makeEye(0.5);

    // ── Stylized lips (a smiling curve made from a thin torus arc) ──
    var lipMat = new THREE.MeshStandardMaterial({ color: col2, emissive: col2.clone().multiplyScalar(0.5), roughness: 0.3, metalness: 0.15 });
    var lips = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.075, 12, 28, Math.PI), lipMat);
    // Rotate the half-torus so its open side faces up → a smile.
    lips.rotation.z = Math.PI;
    lips.position.set(0, -0.34, 1.34);
    face.add(lips);

    // ── Lights (cheap: one ambient + two coloured points echoing the aura) ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var key = new THREE.PointLight(col1.getHex(), 1.4, 20); key.position.set(3, 3, 5); scene.add(key);
    var fill = new THREE.PointLight(col2.getHex(), 1.0, 20); fill.position.set(-3, -1, 4); scene.add(fill);

    // ── Interaction: track pointer relative to this element's viewport ──
    var target = { x: 0, y: 0 };      // normalized -1..1 within the avatar rect
    var current = { x: 0, y: 0 };     // eased follow
    function onPointer(e) {
      var r = mount.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width;   // 0..1
      var py = (e.clientY - r.top) / r.height;   // 0..1
      target.x = Math.max(-1, Math.min(1, (px - 0.5) * 2));
      target.y = Math.max(-1, Math.min(1, (py - 0.5) * 2));
    }
    // Listen on the whole window so the eyes follow the cursor everywhere,
    // per spec (cursor position relative to the element viewport).
    window.addEventListener("pointermove", onPointer, { passive: true });

    // Pause rendering when the avatar scrolls off-screen or the tab is hidden.
    var visible = true;
    var io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(function (entries) {
        visible = entries[0] && entries[0].isIntersecting;
      }, { threshold: 0.05 });
      io.observe(mount);
    }
    function onVisChange() { /* raf loop checks document.hidden */ }
    document.addEventListener("visibilitychange", onVisChange);

    // Resize handling (rail collapse / responsive hero).
    function onResize() {
      var w = mount.clientWidth || 150, h = mount.clientHeight || 150;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    var ro = null;
    if ("ResizeObserver" in window) { ro = new ResizeObserver(onResize); ro.observe(mount); }

    // ── Animation loop ──
    var raf = 0, t0 = performance.now();
    var breathSpeed = (2 * Math.PI) / ((params.breath || 6) * 1000); // rad per ms
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return; // save cycles when not shown
      var t = now - t0;

      // Breathing scale — echoes the CSS orb's cadence + integrity.
      var amp = 0.05 + (params.hot ? 0.03 : 0);
      var s = 1 + Math.sin(t * breathSpeed) * amp;
      twin.scale.set(s, s, s);

      // Gentle idle rotation of the body only (face stays forward).
      body.rotation.y = Math.sin(t * 0.00035) * 0.18;
      body.rotation.x = Math.cos(t * 0.0003) * 0.08;

      // Ease toward pointer; twin tilts slightly, eyes track more strongly.
      current.x += (target.x - current.x) * 0.08;
      current.y += (target.y - current.y) * 0.08;
      twin.rotation.y = current.x * 0.28;
      twin.rotation.x = -current.y * 0.18;

      // Pupils shift within the eye to face the cursor.
      var pxShift = current.x * 0.12, pyShift = -current.y * 0.1;
      leftEye._pupil.position.x = pxShift; leftEye._pupil.position.y = pyShift;
      rightEye._pupil.position.x = pxShift; rightEye._pupil.position.y = pyShift;

      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);

    // Signal success so CSS can fade the fallback orb out.
    mount.setAttribute("data-ready", "1");

    // Teardown to avoid leaks across re-renders.
    C._twinTeardown = function () {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisChange);
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      try {
        bodyGeo.dispose(); glowGeo.dispose(); lips.geometry.dispose();
        renderer.dispose();
      } catch (e) {}
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  function questCard(q) {
    var pct = q.unit === "mg"
      ? Math.max(0, Math.min(100, (1 - Math.min(1, q.progress / (q.goal * 1.6))) * 100))
      : Math.max(0, Math.min(100, (q.progress / q.goal) * 100));
    var hue = C.hue(C.DOMAIN_HUE[q.domain] || "mint");
    return (
      '<div class="quest-card ' + (q.done ? "is-done" : "") + '" style="--qh:' + hue + '">' +
      '<div class="quest-top"><span class="quest-ico"><i class="bi ' + (q.done ? "bi-check-circle-fill" : "bi-lightning-charge-fill") + '"></i></span>' +
      '<span class="quest-xp">+' + q.xp + " XP</span></div>" +
      '<p class="quest-label">' + C.esc(q.label) + "</p>" +
      '<p class="quest-detail">' + C.esc(q.detail) + "</p>" +
      '<div class="quest-bar"><div class="quest-fill" style="width:' + pct.toFixed(0) + '%"></div></div>' +
      '<div class="quest-foot"><span class="tiny mono">' + C.fmt.num(q.progress, q.unit === "h" ? 1 : 0) + " / " + C.fmt.num(q.goal, q.unit === "h" ? 1 : 0) + " " + C.esc(q.unit) + "</span>" +
      (q.lever ? '<button type="button" class="btn btn-tiny" data-arena-lever="' + C.esc(q.lever) + '"><i class="bi bi-sliders"></i> Play</button>' : "") +
      "</div></div>"
    );
  }

  /* Casual-overview vibe KPIs use clean vector (SVG) tech icons instead of
     emojis — one Bootstrap-Icons glyph per domain, tinted to its hue. */
  var VIBE_ICON = { sleep: "bi-moon-stars-fill", mood: "bi-emoji-smile-fill", energy: "bi-heart-pulse-fill", env: "bi-wind" };

  function vibeCell(v, key) {
    var hue = { sleep: "blue", mood: "violet", energy: "rose", env: "cyan" }[key] || "mint";
    var icon = VIBE_ICON[key] || "bi-activity";
    return (
      '<div class="vibe-cell ' + (v.good ? "vibe-good" : "vibe-watch") + '" style="--vh:' + C.hue(hue) + '" tabindex="0" data-vibe="' + key + '">' +
      '<span class="vibe-ico"><i class="bi ' + icon + '" aria-hidden="true"></i></span>' +
      '<span class="vibe-num">' + C.fmt.num(v.value, v.unit === "h" || v.unit === "/10" ? 1 : 0) + '<small>' + C.esc(v.unit) + "</small></span>" +
      '<span class="vibe-label">' + C.esc(v.label) + "</span>" +
      "</div>"
    );
  }

  V.casual = {
    icon: "bi-controller",
    label: "My Twin",
    title: "My Living Twin",
    skeleton: 5,
    load: function () { return C.api("/overview"); },
    render: function (env) {
      var d = env.data;
      var g = d.gamification || {};
      var level = g.level || { level: 1, tier: "Spark", aura: "amber", pctToNext: 0, integrity: 60, engagementScore: 0 };
      var vibe = g.vibe || {};
      var quests = g.quests || [];
      var whisper = g.whisper || { text: "Your twin is waking up…", mood: "flat", icon: "bi-soundwave" };
      var vitals = d.vitals || [];
      var topRisk = (d.risks || []).slice().sort(function (a, b) { return b.score - a.score; })[0] || { label: "—", score: 0, horizon: "" };
      var labels = vitals.map(function (v) { return C.fmt.dayShort(v.day); });

      var out = "";

      /* ── HERO: living twin + level + streak + primary CTAs ── */
      out += '<section class="casual-hero" style="--aura1:' + auraColors(level.aura)[0] + ';--aura2:' + auraColors(level.aura)[1] + '">';
      out += '<div class="hero-left">' + avatar(level, d.air, topRisk) + "</div>";
      out += '<div class="hero-mid">';
      out += '<p class="hero-kicker"><i class="bi bi-geo-alt"></i> ' + C.esc(d.location.city || "Your location") + (d.location.live ? "" : " · approx") + "</p>";
      out += '<h2 class="hero-level">Twin Level ' + level.level + ' <span class="hero-tier">' + C.esc(level.tier) + "</span></h2>";
      out += '<div class="hero-xp"><div class="hero-xp-bar"><div class="hero-xp-fill" style="width:' + (level.pctToNext || 0) + '%"></div></div>' +
        '<span class="tiny mono">' + C.fmt.num(level.pctToNext, 0) + "% to next</span></div>";
      out += '<div class="hero-stats">' +
        '<span class="hero-stat"><i class="bi bi-fire"></i> ' + (g.streak || 0) + '-day streak</span>' +
        '<span class="hero-stat"><i class="bi bi-stars"></i> ' + C.fmt.num(g.todayXp || 0, 0) + ' XP today</span>' +
        '<span class="hero-stat"><i class="bi bi-diagram-3"></i> ' + (d.graphStats ? d.graphStats.edges : 0) + ' connections</span>' +
        "</div>";
      out += '<div class="hero-cta">' +
        '<button type="button" class="btn btn-primary btn-glow" data-open-fuel><i class="bi bi-lightning-charge-fill"></i> Fuel your twin</button>' +
        '<button type="button" class="btn" data-open-arena><i class="bi bi-magic"></i> Play what-if</button>' +
        '<button type="button" class="btn btn-ghost" data-goto="overview"><i class="bi bi-bar-chart-steps"></i> Pro view</button>' +
        "</div>";
      out += "</div>";
      out += '<div class="hero-right">' + Ch.gauge(Math.round(level.integrity), { sub: "Twin aura", max: 100 }) +
        '<p class="tiny" style="text-align:center;color:var(--ink-3);margin-top:-4px">Integrity ' + C.fmt.num(level.integrity, 1) + "% · engagement " + C.fmt.num(level.engagementScore, 0) + "</p></div>";
      out += "</section>";

      /* Data-honesty note — keeps the demo honest even in casual mode. */
      out += '<p class="casual-datamode"><i class="bi bi-shield-check"></i> ' + C.esc(g.dataMode || "seeded baseline + live env") + " · every number recomputed from your causal twin</p>";

      out += '<div class="bento casual-bento">';

      /* ── VIBE KPIs (giant, one-glance) ── */
      out += '<div class="c12" style="--i:0">' + C.card({
        title: "How your twin feels today",
        note: "tap any card to expand the science",
        icon: "bi-emoji-smile",
        body: '<div class="vibe-grid">' +
          vibeCell(vibe.sleep || { value: 0, label: "Sleep", unit: "h", good: false }, "sleep") +
          vibeCell(vibe.mood || { value: 0, label: "Mood", unit: "/10", good: false }, "mood") +
          vibeCell(vibe.energy || { value: 0, label: "Energy", unit: "ms", good: false }, "energy") +
          vibeCell(vibe.env || { value: 0, label: "Air", unit: "AQI", good: false }, "env") +
          "</div>" +
          '<div id="vibe-expand" class="vibe-expand" hidden></div>'
      }) + "</div>";

      /* ── TODAY'S STORY (strongest insight, plain English) ── */
      var topIns = (d.insights || []).slice().sort(function (a, b) { return Math.abs(b.r) - Math.abs(a.r); })[0] || { label: "—", r: 0 };
      out += '<div class="c7" style="--i:1">' + C.card({
        title: "Today's story",
        note: "your twin's strongest discovery",
        icon: "bi-book",
        body:
          '<div class="story-card">' +
          '<p class="story-lead">' + C.esc(storyLine(topIns, d)) + "</p>" +
          '<div class="story-meta"><span class="badge ' + (Math.abs(topIns.r) > 0.45 ? "good" : "") + '">strength ' + stars(Math.abs(topIns.r)) + "</span>" +
          '<button type="button" class="btn btn-tiny sci-toggle" data-sci-toggle><i class="bi bi-eyedropper"></i> science</button></div>' +
          '<div class="story-sci" hidden><p class="tiny mono">Pearson r = ' + C.fmt.num(topIns.r, 2) + " over the twin's 30-day series · " + C.esc(topIns.label) + "</p>" +
          '<button type="button" class="btn btn-tiny" data-goto="graph"><i class="bi bi-share"></i> Explore causal path</button></div>' +
          "</div>" +
          '<div class="mt12">' + Ch.line({
            labels: labels, height: 120, legend: false, xTicks: 4,
            series: [{ name: "Mood", color: C.hue("violet"), values: vitals.map(function (v) { return v.mood; }) }],
            aria: "Mood trend"
          }) + "</div>"
      }) + "</div>";

      /* ── TWIN WHISPER ── */
      out += '<div class="c5" style="--i:2">' + C.card({
        title: "Twin whisper",
        note: "your companion is listening",
        icon: whisper.icon || "bi-soundwave",
        body:
          '<div class="whisper-bubble whisper-' + C.esc(whisper.mood) + '">' +
          '<i class="bi ' + C.esc(whisper.icon || "bi-soundwave") + '"></i>' +
          '<p>' + C.esc(whisper.text) + "</p></div>" +
          '<div class="mt12 chip-row">' +
          '<button type="button" class="btn btn-sm" data-voice-checkin><i class="bi bi-mic"></i> Voice check-in</button>' +
          '<button type="button" class="btn btn-sm" data-goto="assistant"><i class="bi bi-robot"></i> Ask the swarm</button>' +
          "</div>"
      }) + "</div>";

      /* ── QUESTS ── */
      out += '<div class="c12" style="--i:3">' + C.card({
        title: "Today's quests",
        note: g.questsDone + " / " + quests.length + " complete · each strengthens a real causal edge",
        icon: "bi-flag",
        body: '<div class="quest-row">' + quests.map(questCard).join("") + "</div>"
      }) + "</div>";

      /* ── LIVING ENVIRONMENT MIRROR ── */
      out += '<div class="c6" style="--i:4">' + C.card({
        title: "Environmental twin mirror",
        note: "live air + weather as your twin's breathing",
        icon: "bi-wind",
        body: envMirror(d)
      }) + "</div>";

      /* ── RISK TRAFFIC-LIGHT DOMAINS ── */
      out += '<div class="c6" style="--i:5">' + C.card({
        title: "Life domains",
        note: "traffic-light health · tap to mitigate",
        icon: "bi-diagram-3",
        body: '<div class="domain-lights">' + (d.risks || []).map(function (r) {
          var tone = r.score < 34 ? "good" : r.score < 62 ? "warn" : "bad";
          return '<button type="button" class="domain-light ' + tone + '" data-goto="counterfactual">' +
            '<span class="dl-dot"></span>' +
            '<span class="dl-main"><span class="dl-label">' + C.esc(prettyRisk(r.label)) + "</span>" +
            '<span class="dl-sub tiny">' + C.esc(r.horizon) + " · " + (r.score < 34 ? "calm" : r.score < 62 ? "watch" : "act now") + "</span></span>" +
            '<span class="dl-score">' + r.score + "</span></button>";
        }).join("") + "</div>"
      }) + "</div>";

      /* ── SHARE BADGE ── */
      out += '<div class="c12" style="--i:6">' + C.card({
        title: "Proof of wellness",
        note: "share your twin level — digest only, no raw data leaves your device",
        icon: "bi-patch-check",
        body:
          '<div class="badge-share">' +
          '<div class="zk-sticker" style="--aura1:' + auraColors(level.aura)[0] + ';--aura2:' + auraColors(level.aura)[1] + '">' +
          '<span class="zk-emoji"><i class="bi bi-award-fill" aria-hidden="true"></i></span><span class="zk-tier">' + C.esc((g.badge && g.badge.claim) || ("Level " + level.level)) + "</span>" +
          '<span class="zk-digest mono">' + C.fmt.hash((g.badge && g.badge.digest) || "0x0", 6) + "</span></div>" +
          '<div class="badge-actions">' +
          '<button type="button" class="btn btn-sm" data-share-badge><i class="bi bi-share"></i> Share badge</button>' +
          '<button type="button" class="btn btn-sm" data-goto="privacy"><i class="bi bi-shield-lock"></i> How proofs work</button>' +
          "</div></div>"
      }) + "</div>";

      out += "</div>"; // bento

      /* ── FUEL DRAWER + ARENA (hidden until opened) ── */
      out += fuelDrawer(d);
      out += arenaPanel(d);

      return out;
    },
    after: function () { wireCasual(); }
  };

  /* ── plain-language helpers ── */
  function stars(r) {
    var n = r > 0.6 ? 5 : r > 0.45 ? 4 : r > 0.3 ? 3 : r > 0.15 ? 2 : 1;
    var out = '<span class="star-rating" aria-label="strength ' + n + ' of 5">';
    for (var i = 1; i <= 5; i++) {
      out += '<i class="bi ' + (i <= n ? "bi-star-fill" : "bi-star") + '" aria-hidden="true"></i>';
    }
    return out + "</span>";
  }
  function prettyRisk(label) {
    return String(label).replace(/ (trajectory|flare|drift|strain|lapse)$/i, "");
  }
  function storyLine(ins, d) {
    var L = String(ins.label || "");
    var strong = Math.abs(ins.r) > 0.45;
    if (/sleep/i.test(L) && /mood/i.test(L)) return strong ? "When you sleep more, your mood climbs the next day. That link is one of your twin's strongest." : "Sleep and mood are gently linked in your twin — more data will sharpen it.";
    if (/pm2\.5|respiratory/i.test(L)) return "Dirty air days show up as more symptoms for your twin — worth watching the AQI.";
    if (/sodium|systolic/i.test(L)) return "Salty days push your blood pressure up. Your twin feels it.";
    if (/adherence/i.test(L)) return "Taking every dose keeps your pressure in check — your twin rewards the streak.";
    if (/stress|glucose/i.test(L)) return "Stressful days nudge your glucose around. Breathwork helps your twin settle.";
    return "Your twin's loudest pattern: " + L + ". Keep logging to strengthen it.";
  }

  /* ── Environmental mirror (living particle-ish read) ── */
  function envMirror(d) {
    var aqi = d.air.aqi;
    var band = aqi <= 50 ? "clean" : aqi <= 100 ? "moderate" : aqi <= 150 ? "poor" : "hazardous";
    var hue = aqi <= 50 ? "mint" : aqi <= 100 ? "amber" : aqi <= 150 ? "orange" : "rose";
    return (
      '<div class="env-mirror env-' + band + '" style="--eh:' + C.hue(hue) + '">' +
      '<div class="env-breathe"><span></span><span></span><span></span></div>' +
      '<div class="env-read"><span class="env-aqi">' + C.fmt.num(aqi, 0) + '</span><span class="env-aqi-l">AQI · ' + band + "</span></div>" +
      "</div>" +
      '<div class="stat-strip mt12">' +
      C.statCell("PM2.5", C.fmt.num(d.air.pm25, 1), "µg/m³") +
      C.statCell("Temp", C.fmt.num(d.weather.temperature, 0), "°C") +
      C.statCell("Humidity", C.fmt.num(d.weather.humidity, 0), "%") +
      C.statCell("Pollen", C.fmt.num(d.air.pollen, 0), "") +
      "</div>" +
      '<div class="mt12"><button type="button" class="btn btn-sm" data-goto="environment"><i class="bi bi-arrows-fullscreen"></i> Full environment</button></div>'
    );
  }

  /* ══════════════ FUEL DRAWER (zero-friction check-in) ══════════════ */
  function fuelDrawer(d) {
    var f = (C.fuel && C.fuel.today()) || {};
    function slider(id, label, min, max, step, val, unit) {
      return '<label class="fuel-field"><span class="fuel-label">' + C.esc(label) + ' <b id="fv-' + id + '">' + val + (unit ? " " + unit : "") + '</b></span>' +
        '<input type="range" id="fuel-' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" data-fuel-unit="' + (unit || "") + '"></label>';
    }
    var moods = [["bi-emoji-frown-fill", 3], ["bi-emoji-neutral-fill", 5], ["bi-emoji-smile-fill", 7], ["bi-emoji-laughing-fill", 9]];
    return (
      '<div id="fuel-drawer" class="fuel-drawer" hidden>' +
      '<div class="fuel-panel">' +
      '<div class="fuel-head"><h3><i class="bi bi-lightning-charge-fill"></i> Fuel your twin</h3>' +
      '<button type="button" class="topbar-icon-btn" data-close-fuel aria-label="Close"><i class="bi bi-x-lg"></i></button></div>' +
      '<p class="tiny" style="color:var(--ink-3)">One tap each. Your twin updates instantly and shows the causal ripple. Stored on this device; blended into your seeded twin.</p>' +
      '<div class="fuel-emoji-row">' +
      '<span class="fuel-emoji-q">Mood?</span>' +
      moods.map(function (m) { return '<button type="button" class="emoji-btn" data-fuel-mood="' + m[1] + '" aria-label="Mood ' + m[1] + ' of 10"><i class="bi ' + m[0] + '" aria-hidden="true"></i></button>'; }).join("") +
      "</div>" +
      slider("rested", "How rested?", 0, 10, 1, f.rested != null ? f.rested : 6, "") +
      slider("steps", "Steps today", 0, 20000, 250, f.steps != null ? f.steps : 4000, "") +
      slider("hydrationMl", "Water", 0, 4000, 100, f.hydrationMl != null ? f.hydrationMl : 1500, "ml") +
      slider("sodiumMg", "Salt (sodium)", 500, 5000, 50, f.sodiumMg != null ? f.sodiumMg : 2300, "mg") +
      slider("stress", "Stress", 0, 100, 5, f.stress != null ? f.stress : 40, "") +
      '<label class="fuel-check"><input type="checkbox" id="fuel-meds" ' + (f.medsTaken >= 1 ? "checked" : "") + '> Took all my meds today</label>' +
      '<label class="fuel-field"><span class="fuel-label">Note (optional)</span><input type="text" id="fuel-note" class="fuel-note" maxlength="200" placeholder="how are you feeling?" value="' + C.esc(f.note || "") + '"></label>' +
      '<button type="button" class="btn btn-primary btn-glow fuel-submit" data-submit-fuel><i class="bi bi-check2-circle"></i> Log & see ripple</button>' +
      '<div id="fuel-ripple" class="fuel-ripple" hidden></div>' +
      "</div></div>"
    );
  }

  /* ══════════════ WHAT-IF ARENA (casual counterfactual) ══════════════ */
  function arenaPanel(d) {
    var levers = [
      { id: "sleepHours", label: "Sleep", icon: "bi-moon-stars-fill", min: 4, max: 10, step: 0.5, val: (d.latest && d.latest.sleepHours) || 7, unit: "h" },
      { id: "sodiumMg", label: "Salt", icon: "bi-droplet-half", min: 800, max: 5000, step: 100, val: 2300, unit: "mg" },
      { id: "steps", label: "Move", icon: "bi-person-walking", min: 1000, max: 18000, step: 500, val: 6000, unit: "" },
      { id: "screenMin", label: "Screen", icon: "bi-phone", min: 30, max: 700, step: 20, val: 300, unit: "m" }
    ];
    return (
      '<div id="arena-drawer" class="fuel-drawer" hidden>' +
      '<div class="fuel-panel arena-panel">' +
      '<div class="fuel-head"><h3><i class="bi bi-magic"></i> What-If Arena</h3>' +
      '<button type="button" class="topbar-icon-btn" data-close-arena aria-label="Close"><i class="bi bi-x-lg"></i></button></div>' +
      '<p class="tiny" style="color:var(--ink-3)">Drag the levers. Your cartoon twin reacts instantly along its real causal paths.</p>' +
      '<div class="arena-twin" id="arena-twin"><span class="arena-face"><i class="bi bi-emoji-smile-fill" aria-hidden="true"></i></span></div>' +
      '<div class="arena-levers">' + levers.map(function (l) {
        return '<div class="arena-lever"><span class="arena-l-emoji"><i class="bi ' + l.icon + '" aria-hidden="true"></i></span>' +
          '<label class="fuel-label tiny">' + C.esc(l.label) + ' <b id="av-' + l.id + '">' + l.val + (l.unit || "") + "</b></label>" +
          '<input type="range" id="arena-' + l.id + '" min="' + l.min + '" max="' + l.max + '" step="' + l.step + '" value="' + l.val + '" data-arena="' + l.id + '" data-unit="' + (l.unit || "") + '"></div>';
      }).join("") + "</div>" +
      '<div id="arena-out" class="arena-out"><p class="tiny muted">Move a lever to see the ripple…</p></div>' +
      '<div class="arena-foot"><button type="button" class="btn btn-sm" data-arena-commit><i class="bi bi-flag"></i> Commit as quest</button>' +
      '<button type="button" class="btn btn-sm" data-goto="counterfactual"><i class="bi bi-arrows-fullscreen"></i> Full simulator</button></div>' +
      "</div></div>"
    );
  }

  /* ══════════════════ interaction wiring ══════════════════ */
  function wireCasual() {
    var root = C.$("#view-root");
    if (!root) return;

    /* Boot the interactive 3D twin sphere (lazy Three.js, low-resource). */
    initTwin3D();

    /* Vibe expand → mini science line */
    C.$$("[data-vibe]", root).forEach(function (el) {
      el.addEventListener("click", function () {
        var box = C.$("#vibe-expand", root);
        if (!box) return;
        var env = C.state.cache.casual;
        if (!env) return;
        var key = el.getAttribute("data-vibe");
        box.hidden = false;
        box.innerHTML = vibeScience(key, env.data);
        if (C.chart && C.chart.bind) C.chart.bind(box);
      });
    });

    /* Science toggle on story card */
    var sci = C.$("[data-sci-toggle]", root);
    if (sci) sci.addEventListener("click", function () {
      var s = C.$(".story-sci", root);
      if (s) s.hidden = !s.hidden;
    });

    /* Fuel drawer open/close */
    bindOpen(root, "[data-open-fuel]", "#fuel-drawer");
    bindClose(root, "[data-close-fuel]", "#fuel-drawer");
    bindOpen(root, "[data-open-arena]", "#arena-drawer");
    bindClose(root, "[data-close-arena]", "#arena-drawer");

    /* Fuel sliders live label */
    C.$$('input[type=range][id^="fuel-"]', root).forEach(function (inp) {
      inp.addEventListener("input", function () {
        var lbl = C.$("#fv-" + inp.id.replace("fuel-", ""), root);
        if (lbl) lbl.textContent = inp.value + (inp.getAttribute("data-fuel-unit") ? " " + inp.getAttribute("data-fuel-unit") : "");
      });
    });
    /* mood emoji buttons */
    C.$$("[data-fuel-mood]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        C.$$("[data-fuel-mood]", root).forEach(function (x) { x.classList.remove("is-sel"); });
        b.classList.add("is-sel");
        b._mood = Number(b.getAttribute("data-fuel-mood"));
      });
    });

    /* Submit fuel → POST /checkin */
    var submit = C.$("[data-submit-fuel]", root);
    if (submit) submit.addEventListener("click", submitFuel);

    /* Voice check-in (Web Speech) */
    var voice = C.$("[data-voice-checkin]", root);
    if (voice) voice.addEventListener("click", voiceCheckin);

    /* Arena levers */
    C.$$("[data-arena]", root).forEach(function (inp) {
      inp.addEventListener("input", function () {
        var lbl = C.$("#av-" + inp.getAttribute("data-arena"), root);
        if (lbl) lbl.textContent = inp.value + (inp.getAttribute("data-unit") || "");
        runArena();
      });
    });
    C.$$("[data-arena-lever]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        openEl(root, "#arena-drawer");
      });
    });
    var commit = C.$("[data-arena-commit]", root);
    if (commit) commit.addEventListener("click", function () {
      C.toast("Committed as today's quest");
      closeEl(root, "#arena-drawer");
    });

    /* Share badge */
    var share = C.$("[data-share-badge]", root);
    if (share) share.addEventListener("click", shareBadge);
  }

  function bindOpen(root, sel, target) { var b = C.$(sel, root); if (b) b.addEventListener("click", function () { openEl(root, target); }); }
  function bindClose(root, sel, target) { var b = C.$(sel, root); if (b) b.addEventListener("click", function () { closeEl(root, target); }); }
  function openEl(root, sel) { var el = C.$(sel, root); if (el) { el.hidden = false; requestAnimationFrame(function () { el.classList.add("is-open"); }); } }
  function closeEl(root, sel) { var el = C.$(sel, root); if (el) { el.classList.remove("is-open"); setTimeout(function () { el.hidden = true; }, 240); } }

  function vibeScience(key, d) {
    var v = d.vitals || [];
    var map = {
      sleep: { name: "Sleep (h)", hue: "blue", get: function (x) { return x.sleepHours; } },
      mood: { name: "Mood (/10)", hue: "violet", get: function (x) { return x.mood; } },
      energy: { name: "HRV (ms)", hue: "rose", get: function (x) { return x.hrv; } },
      env: { name: "AQI", hue: "cyan", get: function (x) { return x.aqi; } }
    };
    var m = map[key] || map.sleep;
    return '<p class="tiny mono" style="margin-bottom:6px">30-day ' + m.name + " — the same series the Pro view charts</p>" +
      C.chart.line({
        labels: v.map(function (x) { return C.fmt.dayShort(x.day); }),
        height: 120, legend: false, xTicks: 4,
        series: [{ name: m.name, color: C.hue(m.hue), values: v.map(m.get) }],
        aria: m.name
      }) +
      '<button type="button" class="btn btn-tiny mt12" data-goto="overview"><i class="bi bi-bar-chart-steps"></i> Open full Pro view</button>';
  }

  function collectFuel(root) {
    var get = function (id) { var el = C.$("#fuel-" + id, root); return el ? Number(el.value) : undefined; };
    var moodBtn = C.$$("[data-fuel-mood].is-sel", root)[0];
    var note = C.$("#fuel-note", root);
    var meds = C.$("#fuel-meds", root);
    var report = {
      rested: get("rested"),
      steps: get("steps"),
      hydrationMl: get("hydrationMl"),
      sodiumMg: get("sodiumMg"),
      stress: get("stress"),
      medsTaken: meds && meds.checked ? 1 : 0
    };
    if (moodBtn && moodBtn._mood) report.mood = moodBtn._mood;
    if (note && note.value.trim()) report.note = note.value.trim();
    return report;
  }

  function submitFuel() {
    var root = C.$("#view-root");
    var report = collectFuel(root);
    C.fuel.log(report); // persist locally first (drives ?fuel= on all requests)
    var rippleBox = C.$("#fuel-ripple", root);
    if (rippleBox) { rippleBox.hidden = false; rippleBox.innerHTML = '<p class="tiny muted">Consulting your twin…</p>'; }
    C.api("/checkin", null, { body: report }).then(function (env) {
      var g = env.data || {};
      if (rippleBox) {
        rippleBox.innerHTML =
          '<p class="ripple-lead"><i class="bi bi-soundwave"></i> ' + C.esc(g.rippleText || "Logged!") + "</p>" +
          '<div class="ripple-list">' + (g.ripple || []).map(function (r) {
            return '<div class="ripple-item ' + C.esc(r.direction) + '"><i class="bi ' + (r.direction === "better" ? "bi-arrow-up-circle" : "bi-arrow-down-circle") + '"></i> ' + C.esc(r.text) + "</div>";
          }).join("") + "</div>" +
          '<p class="tiny mono" style="margin-top:6px;color:var(--ink-3)">+' + (g.xpEarned || 0) + " XP · streak " + (g.streak || 0) + " · " + C.esc(g.method || "") + "</p>";
      }
      C.celebrate();
      C.toast("Twin fueled! +" + (g.xpEarned || 0) + " XP");
      // Re-render the whole casual view so level/quests/whisper update live.
      setTimeout(function () { C.load("casual", { silent: true }); }, 900);
    }).catch(function (err) {
      if (rippleBox) rippleBox.innerHTML = '<p class="tiny" style="color:var(--rose,#f88)">Could not reach twin: ' + C.esc(String(err.message || err)) + "</p>";
    });
  }

  function voiceCheckin() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { C.toast("Voice not supported here — use the sliders"); openEl(C.$("#view-root"), "#fuel-drawer"); return; }
    var rec = new SR();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    C.toast("Listening… say e.g. 'slept 7 hours, mood good, took meds'");
    rec.onresult = function (e) {
      var text = (e.results[0][0].transcript || "").toLowerCase();
      var report = parseVoice(text);
      report.note = text;
      C.fuel.log(report);
      C.api("/checkin", null, { body: report }).then(function (env) {
        C.celebrate();
        C.toast("Heard: “" + text + "” — twin updated");
        C.load("casual", { silent: true });
      });
    };
    rec.onerror = function () { C.toast("Didn't catch that — try the sliders"); };
    try { rec.start(); } catch (e) { C.toast("Voice unavailable"); }
  }

  function parseVoice(t) {
    var r = {};
    var sleep = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
    if (sleep) r.sleepHours = Number(sleep[1]);
    if (/mood (good|great|happy|fine)/.test(t) || /feeling (good|great|happy)/.test(t)) r.mood = 8;
    if (/mood (bad|low|sad|down)/.test(t) || /feeling (bad|low|sad|down)/.test(t)) r.mood = 4;
    if (/stress(ed)?/.test(t)) r.stress = /very|really|so/.test(t) ? 80 : 60;
    if (/took (my )?meds|took medication|took all/.test(t)) r.medsTaken = 1;
    var steps = t.match(/(\d{3,6})\s*steps/);
    if (steps) r.steps = Number(steps[1]);
    return r;
  }

  /* Arena: local do(...) using the SAME direction as the server engine, for
     instant feedback (server counterfactual is one tap away via "full simulator"). */
  function runArena() {
    var root = C.$("#view-root");
    var v = function (id) { var el = C.$("#arena-" + id, root); return el ? Number(el.value) : 0; };
    var d = (C.state.cache.casual || {}).data || {};
    var base = d.latest || {};
    var dSleep = v("sleepHours") - (base.sleepHours || 7);
    var dSodium = v("sodiumMg") - 2300;
    var dSteps = v("steps") - 6000;
    var dScreen = v("screenMin") - 300;

    var bp = -dSleep * 1.9 + dSodium * 0.0042 - dSteps * 0.0002;
    var mood = dSleep * 0.5 - dScreen * 0.001;
    var hrv = dSleep * 5.4 - dScreen * 0.004;
    var score = -bp + mood * 4 + hrv * 0.3;

    var faceIcon = score > 6 ? "bi-emoji-laughing-fill" : score > 1 ? "bi-emoji-smile-fill"
      : score > -1 ? "bi-emoji-neutral-fill" : score > -6 ? "bi-emoji-frown-fill" : "bi-emoji-dizzy-fill";
    var twin = C.$("#arena-twin .arena-face", root);
    if (twin) { twin.innerHTML = '<i class="bi ' + faceIcon + '" aria-hidden="true"></i>'; twin.parentNode.classList.toggle("arena-happy", score > 1); twin.parentNode.classList.toggle("arena-sad", score < -1); }

    var out = C.$("#arena-out", root);
    if (out) {
      out.innerHTML =
        gauge("Blood pressure", -bp, "mmHg", true) +
        gauge("Mood", mood, "/10", false) +
        gauge("Energy (HRV)", hrv, "ms", false) +
        '<p class="tiny mono" style="margin-top:6px;color:var(--ink-3)">because sleep→BP, sleep→HRV & sodium→BP edges in YOUR graph</p>';
    }
    function gauge(label, delta, unit, lowerBetter) {
      var good = lowerBetter ? delta > 0 : delta > 0;
      var cls = Math.abs(delta) < 0.3 ? "flat" : good ? "up" : "down";
      return '<div class="arena-metric"><span>' + label + "</span><span class=\"delta " + cls + '">' +
        (delta > 0 ? "+" : "") + C.fmt.num(delta, 1) + " " + unit + "</span></div>";
    }
  }

  function shareBadge() {
    var env = C.state.cache.casual;
    var g = (env && env.data && env.data.gamification) || {};
    var badge = g.badge || {};
    var text = "My Vaidyam twin: " + (badge.claim || "leveled up") + " (zk-proof digest " + (badge.digest || "") + ")";
    if (navigator.share) {
      navigator.share({ title: "Vaidyam Twin", text: text, url: badge.verifierUrl || location.href }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + " " + (badge.verifierUrl || "")).then(function () { C.toast("Badge copied to clipboard"); });
    } else {
      C.toast(text);
    }
    C.celebrate();
  }

  /* ── Confetti / celebration (respects reduced-motion) ── */
  C.celebrate = function () {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var layer = document.createElement("div");
    layer.className = "confetti-layer";
    var cols = [C.hue("mint"), C.hue("violet"), C.hue("amber"), C.hue("cyan"), C.hue("rose")];
    for (var i = 0; i < 36; i++) {
      var s = document.createElement("span");
      s.className = "confetti-bit";
      s.style.left = Math.random() * 100 + "%";
      s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * 0.3) + "s";
      s.style.transform = "rotate(" + (Math.random() * 360) + "deg)";
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 2200);
  };
})();
