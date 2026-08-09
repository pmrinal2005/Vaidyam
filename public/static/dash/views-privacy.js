/* Views: zk attestations, DP public-health aggregation, quantized vector memory. */
(function () {
  "use strict";
  var C = (window.Catena = window.Catena || {});
  var V = (C.views = C.views || {});
  var Ch = C.chart;

  /* ══════════════════ PRIVACY / zk ══════════════════ */
  V.privacy = {
    icon: "bi-shield-lock",
    label: "zk Proofs",
    title: "Zero-Knowledge Attestations",
    load: function () { return C.api("/zk/claims", { window: C.state.zkWindow }); },
    render: function (env) {
      var d = env.data;
      var atts = d.attestations || [];
      var satisfied = atts.filter(function (a) { return a.satisfied; }).length;

      var out = C.viewHead(
        "Layer 5 · privacy & verifiability",
        "Zero-Knowledge Health Attestations",
        "This is the move that removes the privacy-versus-societal-value trade-off: an insurer, employer or trial recruiter consumes a <b>proof about a fact</b> — never the fact's underlying data. A deterministic computation over the private series is compiled into a circuit; only the public output plus proof leave the twin. Proof generation runs as a serverless job triggered on request, so it never sits on the raw data path.",
        '<div class="seg" role="group" aria-label="Attestation window">' +
        [7, 14, 30].map(function (w) {
          return '<button type="button" class="seg-btn ' + (C.state.zkWindow === w ? "is-on" : "") + '" data-zkwindow="' + w + '">' + w + "d</button>";
        }).join("") + "</div>" +
        '<span class="badge good">' + satisfied + "/" + atts.length + " claims satisfied</span>"
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Proof boundary",
        note: "what crosses the trust boundary, and what provably does not",
        icon: "bi-shield-check",
        body:
          '<div class="grid2">' +
          '<div class="stat-cell"><p class="stat-k">Leaves the twin</p><p class="stat-v" style="font-size:13px;color:var(--accent)">public output + proof bytes + commitment</p></div>' +
          '<div class="stat-cell"><p class="stat-k">Never leaves the twin</p><p class="stat-v" style="font-size:13px;color:var(--rose)">raw series, timestamps, drug identities, locations</p></div>' +
          "</div>" +
          '<p class="card-note mt12">' + C.esc(d.boundary) + "</p>" +
          '<div class="chip-row mt12">' + (d.toolchains || []).map(function (t) {
            return '<span class="chip is-active" title="' + C.esc(t.detail) + '">' + C.esc(t.name) + " · " + C.esc(t.role) + "</span>";
          }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c12" style="--i:1">' + C.card({
        title: "Attestable claims",
        note: "window " + d.windowDays + " days · each card is independently verifiable by a third party",
        icon: "bi-patch-check",
        body: '<div class="att-grid">' + atts.map(function (a) {
          return (
            '<div class="att ' + (a.satisfied ? "ok" : "no") + '">' +
            '<div class="flexbet"><p class="att-claim mono">' + C.esc(a.claim) + "</p>" +
            '<span class="badge ' + (a.satisfied ? "good" : "bad") + '">' + (a.satisfied ? "satisfied" : "not met") + "</span></div>" +
            '<p class="att-statement">' + C.esc(a.statement) + "</p>" +
            '<div class="agent-meta"><span>' + C.esc(a.proofSystem) + "</span><span>" + C.fmt.compact(a.constraints) + " constraints</span>" +
            "<span>prove " + C.fmt.compact(a.proveMs) + "ms</span><span>verify " + a.verifyMs + "ms</span><span>" + C.fmt.bytes(a.proofSizeBytes) + "</span></div>" +
            '<p class="att-hash mono" title="' + C.esc(a.commitment) + '">commitment ' + C.esc(C.fmt.hash(a.commitment, 8)) + "</p>" +
            '<p class="att-hash mono" title="' + C.esc(a.proofDigest) + '">proof ' + C.esc(C.fmt.hash(a.proofDigest, 8)) + "</p>" +
            '<div class="chip-row mt8">' + (a.witnessFieldsHidden || []).map(function (h) {
              return '<span class="chip">hidden: ' + C.esc(h) + "</span>";
            }).join("") + "</div>" +
            '<div class="wrapgap mt12">' +
            '<button type="button" class="btn btn-sm btn-primary" data-prove="' + C.esc(a.claim) + '"><i class="bi bi-cpu"></i> Generate proof</button>' +
            '<button type="button" class="btn btn-sm" data-verify="' + C.esc(a.id) + '"><i class="bi bi-check2-circle"></i> Verify</button>' +
            "</div>" +
            '<div class="proof-out" id="proof-' + C.esc(a.id) + '" hidden></div>' +
            "</div>"
          );
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c6" style="--i:2">' + C.card({
        title: "Proving cost profile",
        note: "constraint count drives prover time; verification stays constant-time",
        icon: "bi-speedometer2",
        body: Ch.bars({
          labels: atts.map(function (a) { return a.claim.split("_")[0]; }),
          height: 226, rightAxis: true,
          series: [
            { name: "Prove (ms)", color: C.hue("violet"), values: atts.map(function (a) { return a.proveMs; }) },
            { name: "Verify (ms)", color: C.hue("mint"), values: atts.map(function (a) { return a.verifyMs; }) }
          ],
          aria: "Proving and verification time per claim"
        }) +
          '<p class="card-note mt8">Asymmetry is the point — an insurer verifies in milliseconds regardless of how long the twin spent proving.</p>'
      }) + "</div>";

      out += '<div class="c6" style="--i:3">' + C.card({
        title: "Consumers of proofs",
        note: "who verifies what, and what they still cannot see",
        icon: "bi-people",
        body: '<div class="row-list">' + [
          { who: "Insurers", what: "Adherence ≥ 90%, risk-band membership", cannot: "Which drugs, which conditions, which days" },
          { who: "Employers", what: "Activity floor, k-anonymous wellness participation", cannot: "Individual step counts, mental-health signals" },
          { who: "Clinical-trial recruiters", what: "Eligibility predicates over the window", cannot: "Full record, identity, comorbidities" },
          { who: "Pharma post-market", what: "Absence of severe adverse events", cannot: "Personal event narratives" }
        ].map(function (r) {
          return '<div class="row"><div class="row-main"><p class="row-title">' + C.esc(r.who) + "</p>" +
            '<p class="row-sub"><b style="color:var(--accent)">verifies:</b> ' + C.esc(r.what) + "</p>" +
            '<p class="row-sub"><b style="color:var(--rose)">cannot see:</b> ' + C.esc(r.cannot) + "</p></div></div>";
        }).join("") + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    },
    after: function () {
      C.$$("[data-zkwindow]").forEach(function (b) {
        b.addEventListener("click", function () {
          C.state.zkWindow = Number(b.getAttribute("data-zkwindow"));
          C.load("privacy");
        });
      });

      C.$$("[data-prove]").forEach(function (b) {
        b.addEventListener("click", function () {
          var claim = b.getAttribute("data-prove");
          var orig = b.innerHTML;
          b.disabled = true;
          b.innerHTML = '<i class="bi bi-hourglass-split"></i> Proving…';
          C.api("/zk/prove", null, { body: { claim: claim, windowDays: C.state.zkWindow }, timeout: 26000 })
            .then(function (j) {
              var a = j.data.attestation;
              var box = C.$("#proof-" + a.id);
              if (box) {
                box.hidden = false;
                box.innerHTML =
                  '<p class="tiny mono" style="color:var(--accent)">proof emitted · ' + C.fmt.bytes(a.proofSizeBytes) + " · " + C.fmt.compact(a.constraints) + " constraints</p>" +
                  '<pre class="proof-json">' + C.esc(JSON.stringify(a.publicOutput, null, 2)) + "</pre>" +
                  '<p class="tiny mono muted" style="overflow-wrap:anywhere">share token ' + C.esc(j.data.shareToken) + "</p>" +
                  '<a class="btn btn-sm mt8" href="' + C.esc(a.verifierUrl) + '" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right"></i> Open verifier endpoint</a>';
              }
              C.toast("Proof generated — public output only, no raw data disclosed");
            })
            .catch(function (e) { C.toast("Prover unavailable: " + e.message); })
            .then(function () { b.disabled = false; b.innerHTML = orig; });
        });
      });

      C.$$("[data-verify]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-verify");
          C.api("/zk/verify", { id: id }, { timeout: 12000 })
            .then(function (j) {
              var box = C.$("#proof-" + id);
              if (box) {
                box.hidden = false;
                box.innerHTML =
                  '<p class="tiny mono" style="color:' + (j.verified ? "var(--accent)" : "var(--rose)") + '">' +
                  (j.verified ? "VERIFIED" : "REJECTED") + " in " + j.verifierMs + "ms · raw data exposed: " + (j.rawDataExposed ? "yes" : "no") + "</p>" +
                  '<p class="tiny muted">' + C.esc(j.note) + "</p>" +
                  '<p class="tiny mono muted" style="overflow-wrap:anywhere">' + C.esc(j.verificationDigest) + "</p>";
              }
              C.toast(j.verified ? "Verified from public output alone" : "Verification rejected");
            })
            .catch(function (e) { C.toast("Verifier unreachable: " + e.message); });
        });
      });
    }
  };

  /* ══════════════════ PUBLIC HEALTH / DP ══════════════════ */
  V.publichealth = {
    icon: "bi-globe2",
    label: "Public Health",
    title: "DP Public-Health Signal",
    load: function () { return C.api("/public-health", { epsilon: C.state.epsilon, cohort: C.state.cohort }); },
    render: function (env) {
      var d = env.data;
      var m = d.metrics || [];
      var m0 = m[0] || null;
      var rounds = d.rounds || [];

      var out = C.viewHead(
        "Layer 5 · federated DP aggregation",
        "Public-Health & Urban-Planning Signal",
        "Edge functions compute <b>locally noised</b> statistics from each twin's graph and a periodic job combines them — raw records never reach a central store. That is what avoids the classic federated-learning trade-off where aggregation destroys individual nuance while still costing heavy communication. The result is a near-real-time environmental-health signal instead of a multi-week syndromic lag.",
        '<span class="badge info">ε = ' + C.fmt.num(d.epsilon, 2) + "</span>" +
        '<span class="badge violet">cohort ' + C.fmt.compact(d.cohort) + "</span>" +
        '<span class="badge ' + (m0 && m0.kAnonymous ? "good" : "bad") + '">k-anonymous</span>'
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Privacy budget controls",
        note: "smaller ε means stronger privacy and noisier aggregates — the trade-off is explicit, not hidden",
        icon: "bi-sliders2",
        body:
          '<div class="lever"><div class="lever-head"><span class="lever-label">Privacy budget ε</span>' +
          '<span class="lever-val mono" id="eps-out">' + C.fmt.num(d.epsilon, 2) + "</span></div>" +
          '<input type="range" id="eps-range" min="0.1" max="8" step="0.1" value="' + d.epsilon + '" aria-label="Privacy budget epsilon" />' +
          '<p class="lever-base">δ = ' + (m0 && m0.delta != null ? Number(m0.delta).toExponential(0) : "—") + " · " + C.esc((d.budget && d.budget.mechanism) || "gaussian") + "</p></div>" +
          '<div class="lever mt12"><div class="lever-head"><span class="lever-label">Cohort size</span>' +
          '<span class="lever-val mono" id="cohort-out">' + C.fmt.compact(d.cohort) + "</span></div>" +
          '<input type="range" id="cohort-range" min="50" max="50000" step="50" value="' + d.cohort + '" aria-label="Cohort size" />' +
          '<p class="lever-base">noise scales as σ/√n — larger cohorts recover utility without weakening per-user privacy</p></div>' +
          '<div class="stat-strip mt12">' +
          C.statCell("Budget spent", C.fmt.num(d.budget.spent, 3), "ε") +
          C.statCell("Remaining", C.fmt.num(d.budget.remaining, 3), "ε") +
          C.statCell("Clipping norm", C.fmt.num(d.budget.clipping, 1)) +
          C.statCell("Mechanism", '<span style="font-size:12px">Gaussian</span>') +
          "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:1">' + C.card({
        title: "Local truth vs. released aggregate",
        note: "the released value is the only one that ever leaves the twin",
        icon: "bi-eye-slash",
        body: '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Metric</th><th class="num">Local (private)</th><th class="num">Released (noised)</th><th class="num">σ</th><th class="num">Sens.</th><th>Unit</th></tr></thead><tbody>' +
          m.map(function (r) {
            var drift = r.trueLocal ? Math.abs((r.noised - r.trueLocal) / r.trueLocal) * 100 : 0;
            return "<tr><td>" + C.esc(r.label) + "</td>" +
              '<td class="num muted">' + C.fmt.num(r.trueLocal, 2) + "</td>" +
              '<td class="num" style="color:var(--accent)"><b>' + C.fmt.num(r.noised, 2) + "</b>" +
              ' <span class="tiny muted">±' + C.fmt.num(drift, 1) + "%</span></td>" +
              '<td class="num">' + C.fmt.num(r.sigma, 2) + '</td><td class="num">' + C.fmt.num(r.sensitivity, 2) + "</td>" +
              "<td>" + C.esc(r.unit) + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<p class="card-note mt8">The "local" column is shown here only because you are the data owner — an aggregator sees the released column exclusively.</p>'
      }) + "</div>";

      out += '<div class="c5" style="--i:2">' + C.card({
        title: "Noise impact by metric",
        note: "absolute distortion introduced by the Gaussian mechanism",
        icon: "bi-soundwave",
        body: Ch.hbars(m.map(function (r) {
          var drift = r.trueLocal ? Math.abs((r.noised - r.trueLocal) / r.trueLocal) * 100 : 0;
          return {
            label: r.label, value: Math.min(100, drift * 4), display: "±" + C.fmt.num(drift, 2) + "%",
            sub: "σ " + C.fmt.num(r.sigma, 2) + " · sensitivity " + r.sensitivity,
            cls: drift < 2 ? "" : drift < 6 ? "warn" : "bad"
          };
        }), { max: 100 }) +
          '<p class="card-note mt12">At this ε the environmental signal survives aggregation while individual contributions remain indistinguishable.</p>'
      }) + "</div>";

      out += '<div class="c8" style="--i:3">' + C.card({
        title: "Federated aggregation rounds",
        note: "Flower-style periodic aggregation across edge functions",
        icon: "bi-arrow-repeat",
        body: Ch.bars({
          labels: rounds.map(function (r) { return "R" + r.round; }),
          height: 236, rightAxis: true,
          series: [
            { name: "Clients", color: C.hue("mint"), values: rounds.map(function (r) { return r.clients; }) },
            { name: "Dropouts", color: C.hue("rose"), values: rounds.map(function (r) { return r.dropouts; }) },
            { name: "ε spent", color: C.hue("violet"), values: rounds.map(function (r) { return r.epsilonSpent; }) }
          ],
          aria: "Federated rounds, clients and epsilon spend"
        }) +
          '<div class="mt12">' + Ch.line({
            labels: rounds.map(function (r) { return "R" + r.round; }),
            height: 168, rightAxis: true,
            series: [
              { name: "Aggregated PM2.5 (µg/m³)", color: C.hue("cyan"), values: rounds.map(function (r) { return r.aggregatedPm25; }) },
              { name: "Utility loss (%)", color: C.hue("amber"), values: rounds.map(function (r) { return r.utilityLoss; }), axis: "right", area: false, dashed: true }
            ],
            aria: "Aggregated exposure and utility loss per round"
          }) + "</div>"
      }) + "</div>";

      out += '<div class="c4" style="--i:4">' + C.card({
        title: "Cohort signal",
        note: "the actual public-health product",
        icon: "bi-broadcast-pin",
        body:
          '<p class="row-title">' + C.esc(d.signal.label) + "</p>" +
          '<div class="stat-strip mt12">' +
          C.statCell("Correlation", C.fmt.num(d.signal.correlation, 2), "r") +
          C.statCell("Causal lag", C.fmt.num(d.signal.lagHours, 0), "h") +
          "</div>" +
          '<p class="card-note mt12"><b style="color:var(--accent)">Lead time:</b> ' + C.esc(d.signal.leadTimeVsSyndromic) + "</p>" +
          '<div class="mt12">' + Ch.gauge(Math.abs(d.signal.correlation) * 100, { sub: "SIGNAL STRENGTH", color: C.hue("cyan") }) + "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:5">' + C.card({
        title: "Population reference layer",
        note: "open population-health upstream for cohort calibration",
        icon: "bi-people-fill",
        body: '<div class="stat-strip">' +
          C.statCell("Country", '<span style="font-size:14px">' + C.esc(d.population.country) + "</span>") +
          C.statCell("Population", C.fmt.compact(d.population.population)) +
          C.statCell("Cumulative cases", C.fmt.compact(d.population.cases)) +
          C.statCell("New today", C.fmt.compact(d.population.todayCases)) +
          C.statCell("Active", C.fmt.compact(d.population.active)) +
          C.statCell("Tests", C.fmt.compact(d.population.tests)) +
          "</div>" +
          '<p class="card-note mt12">Population counts only calibrate the cohort denominator — no individual twin record is joined against them.</p>'
      }) + "</div>";

      out += '<div class="c5" style="--i:6">' + C.card({
        title: "Aggregation framework",
        note: "how the guarantee is actually enforced",
        icon: "bi-diagram-2",
        body: '<div class="row-list">' + Object.keys(d.framework).map(function (k) {
          return '<div class="row"><div class="row-main"><p class="row-title mono" style="color:var(--accent-2)">' + C.esc(k) + "</p>" +
            '<p class="row-sub">' + C.esc(d.framework[k]) + "</p></div></div>";
        }).join("") + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    },
    after: function () {
      var deb = null;
      var eps = C.$("#eps-range");
      if (eps) eps.addEventListener("input", function () {
        C.state.epsilon = Number(eps.value);
        var o = C.$("#eps-out");
        if (o) o.textContent = C.fmt.num(C.state.epsilon, 2);
        clearTimeout(deb);
        deb = setTimeout(function () { C.load("publichealth", { silent: true }); }, 400);
      });
      var coh = C.$("#cohort-range");
      if (coh) coh.addEventListener("input", function () {
        C.state.cohort = Number(coh.value);
        var o = C.$("#cohort-out");
        if (o) o.textContent = C.fmt.compact(C.state.cohort);
        clearTimeout(deb);
        deb = setTimeout(function () { C.load("publichealth", { silent: true }); }, 400);
      });
    }
  };

  /* ══════════════════ MEMORY / QUANTIZATION ══════════════════ */
  V.memory = {
    icon: "bi-memory",
    label: "Vector Memory",
    title: "Quantized Vector Memory",
    load: function () { return C.api("/memory"); },
    render: function (env) {
      var d = env.data;
      var q = d.quantization || {};
      var sb = d.supabase || {};

      var out = C.viewHead(
        "Memory compression · free-tier envelope",
        "Quantized Vector Memory",
        "A 500MB Postgres cap means embeddings must compress hard without losing retrieval quality. Binary quantization drops each component to one bit — 32× smaller, compared with bitwise operations — and the precision loss is recovered by an int8 re-scoring pass over the binary candidate set. Matryoshka training makes the leading dimensions truncatable, so one embedding serves a mobile check-in and a deep clinical review alike.",
        '<span class="badge good">' + C.fmt.num(q.compressionBinary, 0) + "× binary</span>" +
        '<span class="badge info">' + C.fmt.num(q.speedupBinary, 0) + "× faster retrieval</span>" +
        '<span class="badge ' + (sb.configured ? "good" : "warn") + '">' + (sb.configured ? "Supabase keyed" : "Supabase not keyed") + "</span>"
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Index footprint",
        note: q.vectors ? C.fmt.compact(q.vectors) + " vectors × " + q.dim + " dimensions" : "index not yet built",
        icon: "bi-hdd",
        body: '<div class="stat-strip">' +
          C.statCell("Vectors", C.fmt.compact(q.vectors)) +
          C.statCell("Dimensions", q.dim) +
          C.statCell("float32", C.fmt.bytes(q.float32Bytes)) +
          C.statCell("int8", C.fmt.bytes(q.int8Bytes)) +
          C.statCell("binary", C.fmt.bytes(q.binaryBytes)) +
          C.statCell("Stored total", C.fmt.num(q.usedMb, 2), "MB") +
          C.statCell("Free-tier cap", sb.capMb, "MB") +
          C.statCell("Headroom", C.fmt.num(sb.headroomPct, 1), "%") +
          "</div>" +
          '<div class="mt12">' + C.bar(100 - (sb.headroomPct || 0), (100 - (sb.headroomPct || 0)) > 80 ? "bad" : (100 - (sb.headroomPct || 0)) > 55 ? "warn" : "") + "</div>" +
          '<p class="card-note mt8">float32 is shown for reference only — it is never persisted, because it would breach the envelope long before the graph becomes interesting.</p>'
      }) + "</div>";

      out += '<div class="c7" style="--i:1">' + C.card({
        title: "Two-stage retrieval",
        note: "binary first-pass → int8 re-rank recovers most of the lost recall",
        icon: "bi-layers-half",
        body: '<div class="stage-list">' + (d.retrievalTiers || []).map(function (t, i) {
          return '<div class="stage ' + (i === 2 ? "is-skipped" : "") + '">' +
            '<span class="stage-num">' + (i + 1) + "</span>" +
            '<div style="min-width:0"><p class="stage-name">' + C.esc(t.tier) + "</p>" +
            '<p class="stage-note">' + C.esc(t.note) + "</p>" +
            '<div class="mt8">' + C.bar(t.recall * 100, t.recall > 0.95 ? "" : t.recall > 0.9 ? "warn" : "bad") + "</div></div>" +
            '<div class="stage-metrics"><span>' + C.fmt.bytes(t.bytes) + "</span><span>recall " + C.fmt.pct(t.recall * 100, 1) + "</span>" +
            "<span>" + C.fmt.num(t.latencyMs, 2) + "ms</span></div></div>";
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:2">' + C.card({
        title: "Recall vs. footprint",
        note: "compression is only worth it if recall survives the re-score",
        icon: "bi-crosshair",
        body: Ch.scatter({
          points: (q.matryoshkaDims || []).map(function (mm) {
            return { x: mm.bytes / 1024, y: mm.recall * 100, label: mm.dim + "d" };
          }),
          height: 224,
          xLabel: "index KB",
          yLabel: "recall %",
          color: C.hue("violet"),
          aria: "Recall versus index size across truncation profiles"
        }) +
          '<div class="stat-strip mt12">' +
          C.statCell("Binary recall", C.fmt.pct(q.recallBinary * 100, 1)) +
          C.statCell("After re-score", C.fmt.pct(q.recallRescored * 100, 1)) +
          "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:3">' + C.card({
        title: "Matryoshka truncation profiles",
        note: d.matryoshka ? d.matryoshka.note : "",
        icon: "bi-box-seam",
        body: '<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="num">Dim</th><th class="num">Recall</th><th class="num">Index size</th><th>Use case</th></tr></thead><tbody>' +
          ((d.matryoshka || {}).profiles || []).map(function (p) {
            return '<tr><td class="num mono">' + p.dim + '</td><td class="num" style="color:' + (p.recall > 0.95 ? "var(--accent)" : "var(--ink-2)") + '">' +
              C.fmt.pct(p.recall * 100, 1) + '</td><td class="num">' + C.fmt.bytes(p.bytes) + "</td>" +
              "<td>" + C.esc(p.useCase) + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<div class="mt12">' + Ch.bars({
            labels: ((d.matryoshka || {}).profiles || []).map(function (p) { return p.dim + "d"; }),
            height: 176,
            series: [{ name: "Recall %", color: C.hue("blue"), values: ((d.matryoshka || {}).profiles || []).map(function (p) { return p.recall * 100; }) }],
            aria: "Recall by truncated dimension"
          }) + "</div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:4">' + C.card({
        title: "Graph storage schema",
        note: "Postgres + pgvector · row-level security per twin",
        icon: "bi-table",
        body: '<div class="chip-row">' + (sb.tables || []).map(function (t) {
          return '<span class="chip is-active mono">' + C.esc(t) + "</span>";
        }).join("") + "</div>" +
          '<div class="stat-strip mt12">' +
          C.statCell("Graph version", '<span class="mono" style="font-size:12px">' + C.esc(d.graphVersion) + "</span>") +
          C.statCell("RLS", "per-user isolation") +
          "</div>" +
          '<p class="card-note mt12">Every table is scoped by <span class="mono">auth.uid()</span>, so a twin\'s rows are unreachable from another session even with a leaked anon key. Derived facts are the only thing an aggregation job can read.</p>'
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };
})();
