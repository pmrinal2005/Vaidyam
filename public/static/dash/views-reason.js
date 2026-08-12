/* Views: Causal Graph (HippoRAG/GraphRAG/LightRAG), Agent Swarm (MoA), Inference Cascade, Counterfactual engine. */
(function () {
  "use strict";
  var C = (window.Vaidyam = window.Vaidyam || {});
  var V = (C.views = C.views || {});
  var Ch = C.chart;

  /* ══════════════════ CAUSAL GRAPH ══════════════════ */
  V.graph = {
    icon: "bi-share",
    label: "Causal Graph",
    title: "Causal Knowledge Graph",
    load: function () { return C.api("/graph", { q: C.state.query }); },
    render: function (env) {
      var d = env.data;
      var out = C.viewHead(
        "Layer 1 · personal causal KG",
        "Causal Knowledge Graph",
        "Not a data lake — a compact, versioned graph of entities and causal edges. Built with Microsoft GraphRAG's two-stage pipeline, traversed by HippoRAG-style personalized PageRank, indexed by LightRAG's dual-level scheme so both fine-grained fact lookups and high-level thematic queries stay inside free-tier compute.",
        '<span class="badge info">' + d.stats.nodes + " entities</span>" +
        '<span class="badge violet">' + d.stats.edges + " edges</span>" +
        '<span class="badge">density ' + C.fmt.num(d.stats.density, 3) + "</span>"
      );

      out += '<div class="bento">';

      out += '<div class="c8" style="--i:0">' + C.card({
        title: "Graph topology",
        note: d.seeds && d.seeds.length ? "PPR seeded from: " + d.seeds.join(", ") : "no query — sized by degree centrality. Type a question in the search bar to seed retrieval.",
        icon: "bi-bounding-box-circles",
        body: Ch.graph(d, { focus: C.state.graphFocus, height: 520 }) +
          '<div class="chart-legend mt12">' + Object.keys(C.DOMAIN_COLOR).map(function (k) {
            return '<span class="legend-item"><span class="legend-swatch" style="background:' + C.DOMAIN_COLOR[k] + '"></span>' + C.esc(k) + "</span>";
          }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c4" style="--i:1">' + C.card({
        title: "HippoRAG retrieval",
        note: "personalized PageRank · damping 0.85 · 40 iterations",
        icon: "bi-search",
        body: '<div class="row-list">' + (d.retrieval || []).map(function (r) {
          return (
            '<button type="button" class="row" style="width:100%;text-align:left" data-focus-node="' + C.esc(r.id) + '">' +
            '<span class="row-value" style="width:24px;color:var(--ink-3)">' + r.rank + "</span>" +
            '<div class="row-main"><p class="row-title">' + C.esc(r.label) + "</p>" +
            '<p class="row-sub">' + C.esc(r.domain || "") + " · " + r.hops + "-hop from seed</p></div>" +
            '<span class="badge good">' + C.fmt.num(r.score, 3) + "</span></button>"
          );
        }).join("") + "</div>" +
        '<div class="mt12">' + Object.keys(d.index).map(function (k) {
          return '<p class="row-sub"><b class="mono" style="color:var(--accent-2)">' + C.esc(k) + "</b>: " + C.esc(d.index[k]) + "</p>";
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:2">' + C.card({
        title: "Causal edges — measured, not assumed",
        note: "strength = lagged correlation over this twin's own series",
        icon: "bi-arrow-left-right",
        body: '<div class="tbl-wrap scroll-y"><table class="tbl"><thead><tr><th>Source</th><th>Relation</th><th>Target</th><th class="num">Strength</th><th class="num">Lag</th><th class="num">Conf</th></tr></thead><tbody>' +
          (d.edges || []).slice().sort(function (a, b) { return b.strength - a.strength; }).map(function (e) {
            var s = (d.nodes || []).find(function (n) { return n.id === e.source; });
            var t = (d.nodes || []).find(function (n) { return n.id === e.target; });
            return "<tr><td>" + C.esc(s ? s.label : e.source) + "</td>" +
              '<td class="mono" style="color:var(--accent-2)">' + C.esc(e.relation) + "</td>" +
              "<td>" + C.esc(t ? t.label : e.target) + "</td>" +
              '<td class="num" style="color:' + (e.strength > 0.5 ? "var(--accent)" : "var(--ink-2)") + '">' + C.fmt.num(e.strength, 3) + "</td>" +
              '<td class="num">' + e.lagHours + "h</td>" +
              '<td class="num">' + C.fmt.num(e.confidence, 2) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:3">' + C.card({
        title: "Community summaries",
        note: "GraphRAG stage 2 — pre-generated for closely related entities",
        icon: "bi-collection",
        body: '<div class="row-list scroll-y">' + (d.communities || []).map(function (cm) {
          return '<div class="row"><div class="row-main"><p class="row-title">' + C.esc(cm.label) + "</p>" +
            '<p class="row-sub">' + C.esc(cm.summary) + "</p></div>" +
            '<span class="row-value">' + cm.size + "</span></div>";
        }).join("") + "</div>" +
          '<div class="stat-strip mt12">' +
          C.statCell("Nodes", d.stats.nodes) +
          C.statCell("Edges", d.stats.edges) +
          C.statCell("Avg degree", C.fmt.num(d.stats.avgDegree, 2)) +
          C.statCell("Version", '<span style="font-size:13px">' + C.esc(d.stats.version) + "</span>") +
          "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    },
    after: function () {
      var stage = C.$("#graph-stage");
      var tip = C.$("#graph-tip");
      if (!stage || !tip) return;
      C.$$(".gnode", stage).forEach(function (g) {
        function show(ev) {
          var t = g.querySelector("title");
          var box = stage.getBoundingClientRect();
          var cxy = g.querySelector("circle").getBoundingClientRect();
          tip.innerHTML = "<b>" + C.esc((t ? t.textContent : "").split(" · ")[0]) + "</b><br />" + C.esc((t ? t.textContent : "").split(" · ").slice(1).join(" · "));
          tip.style.left = cxy.left - box.left + cxy.width / 2 + "px";
          tip.style.top = cxy.top - box.top + "px";
          tip.classList.add("is-on");
          if (ev) ev.stopPropagation();
        }
        g.addEventListener("mouseenter", show);
        g.addEventListener("focus", show);
        g.addEventListener("mouseleave", function () { tip.classList.remove("is-on"); });
        g.addEventListener("blur", function () { tip.classList.remove("is-on"); });
        g.addEventListener("click", function () {
          var id = g.getAttribute("data-node");
          C.state.graphFocus = C.state.graphFocus === id ? null : id;
          C.rerender();
        });
      });
    }
  };

  /* ══════════════════ SWARM ══════════════════ */
  V.swarm = {
    icon: "bi-cpu",
    label: "Agent Swarm",
    title: "Multi-Agent Swarm",
    load: function () {
      return C.api("/swarm", null, {
        body: { query: C.state.query || "How is my health trending this week, and does anything need a clinician?" },
        timeout: 32000
      });
    },
    render: function (env) {
      var d = env.data;
      var coord = (d.agents || []).find(function (a) { return a.layer === 2; });
      var l1 = (d.agents || []).filter(function (a) { return a.layer === 1; });

      var out = C.viewHead(
        "Layer 2 · Mixture-of-Agents",
        "Multi-Agent Swarm & Consensus",
        "Six specialist agents run as MoA layers: each layer-2 agent takes every layer-1 output as auxiliary information. For clinically consequential queries the Agent-Forest sampling-and-voting principle spins up " +
        '<span class="mono" style="color:var(--accent)">' + d.route.agentCount + "</span> cheap parallel instantiations and majority-votes — recovering large-model reliability at zero marginal cost.",
        '<button type="button" class="btn btn-sm btn-primary" data-rerun="swarm"><i class="bi bi-play-fill"></i> Re-run swarm</button>' +
        '<span class="badge ' + (d.live ? "good" : "warn") + '">' + (d.live ? "live provider inference" : "deterministic graph reasoner") + "</span>"
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Query under consensus",
        note: "FrugalGPT-style router decision",
        icon: "bi-question-circle",
        body:
          '<p style="font-size:14px;font-weight:550;overflow-wrap:anywhere">' + C.esc(d.query) + "</p>" +
          '<div class="stat-strip mt12">' +
          C.statCell("Draft confidence", C.fmt.num(d.route.draftConfidence, 3)) +
          C.statCell("Consensus", '<span style="font-size:15px;text-transform:capitalize">' + C.esc(d.consensus.vote) + "</span>") +
          C.statCell("Support", C.fmt.num(d.consensus.support, 0), "%") +
          C.statCell("Agents voted", d.route.agentCount) +
          C.statCell("High stakes", d.route.highStakes ? "yes" : "no") +
          C.statCell("Verifier", d.route.escalateVerify ? "invoked" : "skipped") +
          "</div>" +
          '<p class="row-sub mt12"><b style="color:var(--accent-2)">Router:</b> ' + C.esc(d.route.reason) + "</p>"
      }) + "</div>";

      out += '<div class="c7" style="--i:1">' + C.card({
        title: "MoA topology",
        note: "layer 1 specialists → layer 2 coordinator",
        icon: "bi-diagram-3",
        body: Ch.swarmTopology(d.agents || [], d.consensus)
      }) + "</div>";

      out += '<div class="c5" style="--i:2">' + C.card({
        title: "Agent-Forest ballot",
        note: "sampling-and-voting across free-tier providers",
        icon: "bi-check2-square",
        body: Ch.donut(Object.keys(d.consensus.distribution || {}).map(function (k, i) {
          var colors = { maintain: C.hue("mint"), reinforce: C.hue("amber"), intervene: C.hue("rose") };
          return { label: k, value: d.consensus.distribution[k], color: colors[k] || [C.hue("blue"), C.hue("violet")][i % 2] };
        }), { center: String(Math.round(d.consensus.support)) + "%", centerSub: "SUPPORT" }) +
          '<div class="mt12">' + Ch.hbars((d.retrievalTop || []).map(function (r) {
            return { label: r.label, value: r.score, display: C.fmt.num(r.score, 3), cls: "cool" };
          }), { max: 1 }) + "</div>" +
          '<p class="card-note mt8">Top PPR-retrieved entities feeding every agent\'s context.</p>'
      }) + "</div>";

      if (coord) {
        out += '<div class="c12" style="--i:3">' + C.card({
          title: "Preventive-Care Coordinator — fused recommendation",
          note: coord.model + " · " + coord.latencyMs + "ms · confidence " + coord.confidence,
          icon: "bi-stars",
          body:
            '<p style="font-size:14px;line-height:1.65;overflow-wrap:anywhere">' + C.esc(coord.rationale) + "</p>" +
            '<div class="chip-row mt12"><span class="chip is-active">vote: ' + C.esc(coord.vote) + "</span>" +
            '<span class="chip">provider: ' + C.esc(coord.provider) + "</span>" +
            '<span class="chip">tokens: ' + coord.tokens + "</span></div>" +
            '<p class="card-note mt8">Decision-support only — Vaidyam does not diagnose; high-stakes outputs recommend clinician review.</p>'
        }) + "</div>";
      }

      out += '<div class="c12" style="--i:4">' + C.card({
        title: "Layer-1 specialist verdicts",
        note: "each agent reasons only over the supplied causal-graph context",
        icon: "bi-people",
        body: '<div class="agent-grid">' + l1.map(function (a) {
          var col = C.DOMAIN_COLOR[a.domain] || C.hue("mint");
          return (
            '<div class="agent"><div class="agent-top">' +
            '<span class="agent-dot" style="background:' + col + '"></span>' +
            '<span class="agent-name">' + C.esc(a.name) + "</span>" +
            '<span class="badge ' + (a.vote === "maintain" ? "good" : a.vote === "reinforce" ? "warn" : "bad") + '">' + C.esc(a.vote) + "</span></div>" +
            '<p class="agent-body">' + C.esc(a.rationale) + "</p>" +
            '<div class="agent-meta"><span>' + C.esc(a.provider) + "</span><span>" + C.esc(a.model) + "</span>" +
            "<span>" + a.latencyMs + "ms</span><span>" + a.tokens + " tok</span><span>conf " + a.confidence + "</span></div></div>"
          );
        }).join("") + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };

  /* ══════════════════ CASCADE ══════════════════ */
  V.cascade = {
    icon: "bi-lightning-charge",
    label: "Cascade",
    title: "Inference Cascade",
    load: function () { return C.api("/cascade", { q: C.state.query }); },
    render: function (env) {
      var d = env.data;
      var out = C.viewHead(
        "Layer 3 · draft-verify speculative cascade",
        "Inference Efficiency Cascade",
        "A Groq LPU draft model speculates most of the answer using EAGLE-style feature-level speculation; the NVIDIA NIM 70B model verifies only divergent spans — not a full re-generation. Medusa-style parallel heads engage for multi-branch clinical reasoning, and OpenRouter supplies the Agent-Forest voting pool. A FrugalGPT router decides, per query, which stages actually run.",
        '<span class="badge good">acceptance ' + C.fmt.num(d.totals.acceptance * 100, 1) + "%</span>" +
        '<span class="badge info">' + d.totals.latencyMs + "ms end-to-end</span>"
      );

      out += '<div class="bento">';

      out += '<div class="c8" style="--i:0">' + C.card({
        title: "Cascade stages",
        note: "invoked stages only incur work — skipped stages cost nothing",
        icon: "bi-layers",
        body: '<div class="stage-list">' + (d.stages || []).map(function (s, i) {
          return (
            '<div class="stage ' + (s.invoked ? "" : "is-skipped") + '">' +
            '<span class="stage-num">' + (i + 1) + "</span>" +
            '<div style="min-width:0"><p class="stage-name">' + C.esc(s.stage) + "</p>" +
            '<p class="stage-note">' + C.esc(s.note) + "</p>" +
            '<div class="agent-meta"><span>' + C.esc(s.provider) + "</span><span>" + C.esc(s.model) + "</span><span>role: " + C.esc(s.role) + "</span></div></div>" +
            '<div class="stage-metrics"><span>' + s.latencyMs + "ms</span><span>" + s.tokensIn + " in / " + s.tokensOut + " out</span>" +
            "<span>accept " + C.fmt.num(s.acceptanceRate * 100, 0) + "%</span><span>$" + C.fmt.num(s.costUsd, 2) + "</span></div></div>"
          );
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c4" style="--i:1">' + C.card({
        title: "Cost vs frontier baseline",
        note: "same reasoning depth billed on a frontier cloud model",
        icon: "bi-cash-coin",
        body:
          '<div class="stat-strip">' +
          C.statCell("Vaidyam cost", "$" + C.fmt.num(d.totals.costUsd, 2)) +
          C.statCell("Baseline cost", "$" + C.fmt.num(d.totals.baselineCostUsd * 1000, 3) + "/1k") +
          C.statCell("Savings", C.fmt.num(d.totals.savings, 0), "%") +
          C.statCell("Acceptance", C.fmt.num(d.totals.acceptance * 100, 1), "%") +
          "</div>" +
          '<div class="mt16">' + Ch.gauge(d.totals.acceptance * 100, { sub: "TOKENS ACCEPTED", color: C.hue("blue") }) + "</div>" +
          '<p class="card-note" style="text-align:center">Speculated tokens accepted without verifier work.</p>'
      }) + "</div>";

      out += '<div class="c7" style="--i:2">' + C.card({
        title: "24-hour cascade utilisation",
        note: "most daily check-ins never leave step 1",
        icon: "bi-bar-chart-steps",
        body: Ch.bars({
          labels: (d.utilisation || []).map(function (u) { return String(u.hour).padStart(2, "0"); }),
          height: 232,
          stacked: true,
          xTicks: 12,
          series: [
            { name: "Draft only", color: C.hue("mint"), values: (d.utilisation || []).map(function (u) { return u.draftOnly; }) },
            { name: "Verified", color: C.hue("blue"), values: (d.utilisation || []).map(function (u) { return u.verified; }) },
            { name: "Swarm consensus", color: C.hue("violet"), values: (d.utilisation || []).map(function (u) { return u.swarm; }) }
          ],
          aria: "Cascade stage utilisation by hour"
        }) +
          '<div class="stat-strip mt12">' +
          C.statCell("Queries / 24h", d.summary.totalQueries) +
          C.statCell("Draft-only", C.fmt.num(d.summary.draftOnlyShare, 0), "%") +
          C.statCell("Verifier", C.fmt.num(d.summary.verifierShare, 0), "%") +
          C.statCell("Swarm", C.fmt.num(d.summary.swarmShare, 0), "%") +
          "</div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:3">' + C.card({
        title: "Free-tier provider quotas",
        note: "router avoids exhausted providers automatically",
        icon: "bi-hdd-stack",
        body: '<div class="row-list">' + (d.summary.providers || []).map(function (p) {
          return (
            '<div class="row"><div class="row-main"><p class="row-title">' + C.esc(p.label) +
            ' <span class="badge ' + (p.keyed ? "good" : "warn") + '" style="margin-left:6px">' + (p.keyed ? "keyed" : "no key") + "</span></p>" +
            '<p class="row-sub mono">draft ' + C.esc(p.draftModel) + " · verify " + C.esc(p.verifyModel) + "</p>" +
            '<div class="mt8">' + C.bar(p.quotaUsed, p.quotaUsed > 80 ? "bad" : p.quotaUsed > 55 ? "warn" : "") + "</div></div>" +
            '<span class="row-value">' + p.quotaUsed + "%</span></div>"
          );
        }).join("") + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };

  /* ══════════════════ COUNTERFACTUAL ══════════════════ */
  V.counterfactual = {
    icon: "bi-sliders",
    label: "What-if",
    title: "Counterfactual Engine",
    load: function () {
      return C.api("/counterfactual", null, {
        body: { interventions: C.state.interventions, horizonMonths: C.state.horizon, withLiterature: true },
        timeout: 26000
      });
    },
    render: function (env) {
      var d = env.data;
      var out = C.viewHead(
        "Layer 4 · do-calculus approximation",
        "Counterfactual Simulation",
        "Perturbs edge weights on your own causal graph and re-propagates the effect forward: <span class=\"mono\">do(X = x)</span> severs incoming edges of X, then downstream nodes recompute along the graph's measured lags and strengths. Effect sizes come from your edges — a twin with a weak sodium→BP edge sees a smaller projected benefit."
      );

      out += '<div class="bento">';

      out += '<div class="c4" style="--i:0">' + C.card({
        title: "Intervention levers",
        note: "baselines = your own 14-day means",
        icon: "bi-sliders2-vertical",
        right: '<button type="button" class="btn btn-sm" id="cf-reset"><i class="bi bi-arrow-counterclockwise"></i> Reset</button>',
        body: '<div>' + (d.levers || []).map(function (l) {
          var val = d.interventions[l.id] !== undefined ? d.interventions[l.id] : l.baseline;
          var delta = val - l.baseline;
          var unit = l.unit || "";
          return (
            '<div class="lever"><div class="lever-head"><span class="lever-label">' + C.esc(l.label) + "</span>" +
            '<span class="lever-val" id="cfv-' + C.esc(l.id) + '" data-unit="' + C.esc(unit) + '">' +
            C.fmt.num(val, l.step < 1 ? 2 : 0) + (unit ? " " + C.esc(unit) : "") + "</span></div>" +
            '<input type="range" data-lever="' + C.esc(l.id) + '" data-unit="' + C.esc(unit) + '" min="' + l.min + '" max="' + l.max + '" step="' + l.step + '" value="' + val + '" ' +
            'aria-label="' + C.esc(l.label) + '" />' +
            '<p class="lever-base">baseline ' + C.fmt.num(l.baseline, l.step < 1 ? 2 : 0) + (unit ? " " + C.esc(unit) : "") +
            (Math.abs(delta) > l.step / 2 ? ' · <span style="color:var(--accent)">' + (delta > 0 ? "+" : "") + C.fmt.num(delta, l.step < 1 ? 2 : 0) + "</span>" : "") +
            " · node " + C.esc(l.node) + "</p></div>"
          );
        }).join("") + "</div>" +
          '<div class="mt12"><p class="card-note">Horizon</p><div class="chip-row mt8">' +
          [12, 24, 60, 120].map(function (h) {
            return '<button type="button" class="chip ' + (C.state.horizon === h ? "is-active" : "") + '" data-horizon="' + h + '">' + (h / 12) + "-year</button>";
          }).join("") + "</div></div>"
      }) + "</div>";

      out += '<div class="c8" style="--i:1">' + C.card({
        title: "Projected outcomes",
        note: "confidence " + C.fmt.num(d.confidence, 2) + " · behavioural adherence cost " + C.fmt.num(d.adherenceCost, 0) + "/100",
        icon: "bi-graph-up",
        body: Ch.waterfall((d.outcomes || []).map(function (o) {
          return { label: o.label, value: o.delta, unit: o.unit, good: o.direction === "better" };
        }), { height: 236 }) +
          '<div class="tbl-wrap mt12"><table class="tbl"><thead><tr><th>Outcome</th><th class="num">Baseline</th><th class="num">Projected</th><th class="num">Δ</th><th class="num">Δ%</th><th>Causal path</th></tr></thead><tbody>' +
          (d.outcomes || []).map(function (o) {
            var cls = o.direction === "better" ? "good" : o.direction === "worse" ? "bad" : "";
            return "<tr><td><b>" + C.esc(o.label) + "</b> <span class=\"muted\">" + C.esc(o.unit) + "</span></td>" +
              '<td class="num">' + C.fmt.num(o.baseline, 1) + '</td><td class="num">' + C.fmt.num(o.projected, 1) + "</td>" +
              '<td class="num"><span class="badge ' + cls + '">' + (o.delta > 0 ? "+" : "") + C.fmt.num(o.delta, 2) + "</span></td>" +
              '<td class="num">' + C.fmt.num(o.deltaPct, 1) + "%</td>" +
              '<td class="mono tiny">' + C.esc((o.path || []).join(" → ")) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:2">' + C.card({
        title: "Adherence cost of this plan",
        note: "larger deviations from current behaviour are harder to sustain",
        icon: "bi-person-check",
        body: Ch.gauge(d.adherenceCost, { sub: "DIFFICULTY", color: d.adherenceCost < 34 ? C.hue("mint") : d.adherenceCost < 64 ? C.hue("amber") : C.hue("rose") }) +
          '<p class="row-sub" style="text-align:center">' + C.esc(d.method) + "</p>"
      }) + "</div>";

      out += '<div class="c7" style="--i:3">' + C.card({
        title: "Literature grounding",
        note: "live PubMed E-utilities / Europe PMC for the active intervention set",
        icon: "bi-journal-medical",
        body: (d.citations || []).length
          ? '<div class="row-list scroll-y">' + d.citations.map(function (cit) {
              return '<a class="row" href="' + C.esc(cit.url) + '" target="_blank" rel="noopener noreferrer">' +
                '<div class="row-main"><p class="row-title">' + C.esc(cit.title) + "</p>" +
                '<p class="row-sub">' + C.esc(cit.journal) + " · " + C.esc(cit.year) + (cit.pmid ? " · PMID " + C.esc(cit.pmid) : "") + "</p></div>" +
                '<i class="bi bi-box-arrow-up-right muted"></i></a>';
            }).join("") + "</div>"
          : '<p class="empty">Literature upstream unavailable right now — simulation still runs on your graph.</p>'
      }) + "</div>";

      out += "</div>";
      return out;
    },
    after: function () {
      var deb = null;
      C.$$('input[data-lever]').forEach(function (inp) {
        inp.addEventListener("input", function () {
          var id = inp.getAttribute("data-lever");
          var val = Number(inp.value);
          C.state.interventions[id] = val;
          var out = C.$("#cfv-" + id);
          if (out) {
            var step = Number(inp.step);
            /* Unit is stored on data-unit — never re-parse the label text.
               (Previously split(" ").slice(1) corrupted multi-word units like
               "mmHg" was fine but "hrs / night" and values like "-1.5 mg"
               accumulated garbage on every input event.) */
            var unit = inp.getAttribute("data-unit") || out.getAttribute("data-unit") || "";
            out.textContent = C.fmt.num(val, step < 1 ? 2 : 0) + (unit ? " " + unit : "");
          }
          clearTimeout(deb);
          deb = setTimeout(function () { C.load("counterfactual", { silent: true }); }, 420);
        });
      });
      var reset = C.$("#cf-reset");
      if (reset) reset.addEventListener("click", function () {
        C.state.interventions = {};
        C.load("counterfactual");
      });
      C.$$("[data-horizon]").forEach(function (b) {
        b.addEventListener("click", function () {
          C.state.horizon = Number(b.getAttribute("data-horizon"));
          C.load("counterfactual");
        });
      });
    }
  };
})();
