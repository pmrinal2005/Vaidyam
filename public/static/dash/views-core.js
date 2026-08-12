/* Views: Overview, Ingestion pipeline, SaaS surfaces. */
(function () {
  "use strict";
  var C = (window.Vaidyam = window.Vaidyam || {});
  var V = (C.views = C.views || {});
  var Ch = C.chart;

  /* ══════════════════ OVERVIEW ══════════════════ */
  V.overview = {
    icon: "bi-grid-1x2",
    label: "Overview",
    title: "Twin Overview",
    load: function () { return C.api("/overview"); },
    render: function (env) {
      var d = env.data;
      var vitals = d.vitals || [];
      var labels = vitals.map(function (v) { return C.fmt.dayShort(v.day); });
      var topRisk = (d.risks || []).slice().sort(function (a, b) { return b.score - a.score; })[0] || { label: "—", score: 0, horizon: "" };

      var kpis = (d.kpis || []).map(function (k) {
        var hueName = k.key === "aqi" ? "cyan" : k.key === "bp" ? "rose" : k.key === "adherence" ? "mint" : k.key === "hrv" ? "blue" : "violet";
        var color = C.hue(hueName);
        var invert = k.key === "aqi" || k.key === "bp";
        var digits = k.key === "twin" ? 1 : 0;
        return C.kpiCell({
          label: k.label,
          value: k.value,
          display: C.fmt.num(k.value, digits),
          unit: k.unit,
          spark: k.spark,
          color: color,
          delta: k.delta,
          invert: invert,
          foot: invert ? "lower is better" : "higher is better"
        });
      }).join("");

      var out = C.viewHead(
        "Layer 0–1 · digital twin",
        "Twin Overview",
        "A continuously-updating causal model of one person — medication, sleep, environment, mental health and nutrition reasoned over together, not siloed per-institution. " +
        '<span class="mono" style="color:var(--accent-2)">' + C.esc(d.location.city + (d.location.region ? ", " + d.location.region : "")) + "</span> · graph " +
        '<span class="mono">' + C.esc(d.graphStats.version) + "</span>",
        '<button type="button" class="btn btn-sm" data-goto="clinician"><i class="bi bi-file-earmark-medical"></i> Clinician brief</button>' +
        '<button type="button" class="btn btn-sm btn-primary" data-goto="counterfactual"><i class="bi bi-sliders"></i> Simulate what-if</button>'
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Live signal panel",
        note: "every value derived from live sources + the twin's own series",
        body: '<div class="kpi-grid">' + kpis + "</div>"
      }) + "</div>";

      out += '<div class="c8" style="--i:1">' + C.card({
        title: "Cardiometabolic trajectory · 30 days",
        note: "systolic / diastolic vs sleep — measured lag 24h",
        icon: "bi-activity",
        body: Ch.line({
          labels: labels,
          height: 250,
          rightAxis: true,
          series: [
            { name: "Systolic (mmHg)", color: C.hue("rose"), values: vitals.map(function (v) { return v.systolic; }) },
            { name: "Diastolic (mmHg)", color: C.hue("amber"), values: vitals.map(function (v) { return v.diastolic; }), area: false },
            { name: "Sleep (h)", color: C.hue("blue"), values: vitals.map(function (v) { return v.sleepHours; }), axis: "right", area: false, dashed: true }
          ],
          bands: [{ from: 130, to: 200, color: "rgba(255,143,163,0.06)" }],
          aria: "Blood pressure and sleep over 30 days"
        })
      }) + "</div>";

      out += '<div class="c4" style="--i:2">' + C.card({
        title: "Risk trajectory",
        note: "graph-weighted, multi-horizon",
        icon: "bi-radar",
        body:
          Ch.gauge(topRisk.score, { sub: topRisk.horizon }) +
          '<p class="tiny" style="text-align:center;margin-top:-6px;color:var(--ink-2)">' + C.esc(topRisk.label) + "</p>" +
          '<div class="mt12">' + Ch.hbars((d.risks || []).map(function (r) {
            return {
              label: r.label, value: r.score, display: r.score + " · " + r.horizon,
              cls: r.score < 34 ? "" : r.score < 62 ? "warn" : "bad"
            };
          }), { max: 100 }) + "</div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:3">' + C.card({
        title: "Cross-domain causal insights",
        note: "Pearson r over the twin's 30-day series",
        icon: "bi-diagram-3",
        body: '<div class="row-list">' + (d.insights || []).map(function (ins) {
          var strong = Math.abs(ins.r) > 0.45;
          return (
            '<div class="row"><div class="row-main"><p class="row-title">' + C.esc(ins.label) + "</p>" +
            '<p class="row-sub">' + (strong ? "Strong coupling — drives recommendations" : "Weak coupling in this twin") + "</p></div>" +
            '<span class="badge ' + (strong ? "good" : "") + '">r ' + C.fmt.num(ins.r, 2) + "</span></div>"
          );
        }).join("") + "</div>" +
        '<div class="mt12"><button type="button" class="btn btn-sm" data-goto="graph"><i class="bi bi-share"></i> Open causal graph</button></div>'
      }) + "</div>";

      out += '<div class="c4" style="--i:4">' + C.card({
        title: "Environment now",
        note: "Open-Meteo · " + (d.location.live ? "geolocated" : "edge-inferred"),
        icon: "bi-wind",
        body:
          '<div class="stat-strip">' +
          C.statCell("US AQI", C.fmt.num(d.air.aqi, 0), "", C.tipModel("US AQI", [{ name: "AQI", value: C.fmt.num(d.air.aqi, 0), color: C.hue("cyan") }], "Open-Meteo air quality")) +
          C.statCell("PM2.5", C.fmt.num(d.air.pm25, 1), "µg/m³", C.tipModel("PM2.5", [{ name: "PM2.5", value: C.fmt.num(d.air.pm25, 1), unit: "µg/m³", color: C.hue("cyan") }])) +
          C.statCell("Ozone", C.fmt.num(d.air.ozone, 0), "µg/m³", C.tipModel("Ozone", [{ name: "O₃", value: C.fmt.num(d.air.ozone, 0), unit: "µg/m³", color: C.hue("amber") }])) +
          C.statCell("Temp", C.fmt.num(d.weather.temperature, 1), "°C", C.tipModel("Temperature", [{ name: "Temp", value: C.fmt.num(d.weather.temperature, 1), unit: "°C", color: C.hue("orange") }])) +
          C.statCell("Humidity", C.fmt.num(d.weather.humidity, 0), "%", C.tipModel("Humidity", [{ name: "RH", value: C.fmt.num(d.weather.humidity, 0), unit: "%", color: C.hue("blue") }])) +
          C.statCell("Pollen", C.fmt.num(d.air.pollen, 0), "", C.tipModel("Pollen", [{ name: "Index", value: C.fmt.num(d.air.pollen, 0), color: C.hue("violet") }])) +
          "</div>" +
          '<div class="mt12">' + Ch.line({
            labels: (d.air.hourlyTime || []).map(function (t) { return String(t).slice(11, 16); }),
            height: 118, xTicks: 5, legend: false,
            series: [{ name: "PM2.5", color: C.hue("cyan"), values: d.air.hourly || [] }],
            aria: "48 hour PM2.5"
          }) + "</div>"
      }) + "</div>";

      out += '<div class="c3" style="--i:5">' + C.card({
        title: "Next dose",
        note: d.nextDose ? C.fmt.until(d.nextDose.at) : "no active regimen",
        icon: "bi-capsule",
        body:
          (d.nextDose
            ? '<p class="kpi-value" style="font-size:20px">' + C.esc(d.nextDose.name) + "</p>" +
              '<p class="card-note">' + C.esc(d.nextDose.dose) + " · " + C.fmt.time(d.nextDose.at) + "</p>"
            : '<p class="muted tiny">No scheduled medication.</p>') +
          '<div class="mt12">' + Ch.hbars((d.medications || []).map(function (m) {
            return {
              label: m.name, value: m.adherence, display: m.adherence + "%",
              cls: m.adherence >= 90 ? "" : m.adherence >= 78 ? "warn" : "bad",
              sub: m.schedule + " · refill in " + m.refillInDays + "d"
            };
          }), { max: 100 }) + "</div>" +
          '<div class="mt12"><button type="button" class="btn btn-sm" data-goto="medication"><i class="bi bi-capsule-pill"></i> Regimen detail</button></div>'
      }) + "</div>";

      out += '<div class="c6" style="--i:6">' + C.card({
        title: "Recovery & autonomic state",
        note: "HRV, resting HR, SpO₂ — environment-coupled",
        icon: "bi-heart-pulse",
        body: Ch.line({
          labels: labels, height: 218, rightAxis: true,
          series: [
            { name: "HRV (ms)", color: C.hue("blue"), values: vitals.map(function (v) { return v.hrv; }) },
            { name: "Resting HR (bpm)", color: C.hue("orange"), values: vitals.map(function (v) { return v.restingHr; }), area: false },
            { name: "PM2.5 (µg/m³)", color: C.hue("cyan"), values: vitals.map(function (v) { return v.pm25; }), axis: "right", area: false, dashed: true }
          ],
          aria: "HRV, resting heart rate and PM2.5"
        })
      }) + "</div>";

      out += '<div class="c6" style="--i:7">' + C.card({
        title: "Mood · stress · symptom load",
        note: "mental-health domain fused with symptom expression",
        icon: "bi-emoji-neutral",
        body: Ch.line({
          labels: labels, height: 218, rightAxis: true,
          series: [
            { name: "Mood (/10)", color: C.hue("violet"), values: vitals.map(function (v) { return v.mood; }) },
            { name: "Symptom load (/10)", color: C.hue("rose"), values: vitals.map(function (v) { return v.symptomLoad; }), area: false },
            { name: "Stress (/100)", color: C.hue("amber"), values: vitals.map(function (v) { return v.stress; }), axis: "right", area: false, dashed: true }
          ],
          aria: "Mood, symptom load and stress"
        })
      }) + "</div>";

      out += '<div class="c5" style="--i:8">' + C.card({
        title: "Graph communities",
        note: "GraphRAG stage-2 community summaries",
        icon: "bi-bounding-box",
        body: '<div class="row-list scroll-y">' + (d.communities || []).map(function (cm) {
          return (
            '<div class="row"><div class="row-main"><p class="row-title">' + C.esc(cm.label) + "</p>" +
            '<p class="row-sub">' + C.esc(cm.summary) + "</p></div>" +
            '<span class="row-value">' + cm.size + "</span></div>"
          );
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:9">' + C.card({
        title: "Multi-domain output surfaces",
        note: "Layer 6 — one twin, five consumers",
        icon: "bi-broadcast",
        body: '<div class="row-list">' + (d.surfaces || []).map(function (s) {
          var target = { personal: "overview", clinician: "clinician", proof: "privacy", publichealth: "publichealth", pharma: "saas" }[s.id] || "overview";
          return (
            '<button type="button" class="row" style="text-align:left;width:100%" data-goto="' + target + '">' +
            '<div class="row-main"><p class="row-title">' + C.esc(s.label) + "</p>" +
            '<p class="row-sub">' + C.esc(s.detail) + "</p></div>" +
            '<span class="badge ' + (s.status === "active" ? "good" : "warn") + '">' + C.esc(s.status) + "</span></button>"
          );
        }).join("") + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };

  /* ══════════════════ INGESTION ══════════════════ */
  V.ingestion = {
    icon: "bi-hdd-network",
    label: "Ingestion",
    title: "Layer 0 · Ingestion",
    load: function () { return C.api("/ingestion"); },
    render: function (env) {
      var d = env.data;
      var out = C.viewHead(
        "Layer 0 · webhooks → graph",
        "Ingestion & Twin Construction",
        "Free-API webhooks land in an edge function, are parsed, then entity/relation-extracted with the GraphRAG two-stage pipeline and written into <span class=\"mono\">entities</span> / <span class=\"mono\">causal_edges</span> / <span class=\"mono\">observations</span>. Raw streams are collapsed into causal structure — this is not a data lake."
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Pipeline throughput",
        note: "GraphRAG stage 1 → stage 2 → graph write → quantized embedding",
        icon: "bi-diagram-2",
        body: '<div class="stat-strip">' + (d.pipeline || []).map(function (p) {
          return C.statCell(p.stage, '<span style="font-size:13px">' + C.esc(p.throughput) + "</span>") +
            "";
        }).join("") + "</div>" +
          '<div class="mt12 chip-row">' + (d.pipeline || []).map(function (p) {
            return '<span class="chip">' + C.esc(p.stage) + " · " + C.esc(p.detail) + "</span>";
          }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:1">' + C.card({
        title: "Source feeds",
        note: "live status per upstream",
        icon: "bi-router",
        body: '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Source</th><th>Domain</th><th>Cadence</th><th class="num">Records</th><th class="num">Entities</th><th class="num">Edges</th><th class="num">Parse</th><th>Last</th></tr></thead><tbody>' +
          (d.events || []).map(function (e) {
            return "<tr><td><span class=\"badge " + (e.live ? "good" : "warn") + '" style="margin-right:6px">' + (e.live ? "live" : "sim") + "</span>" + C.esc(e.label) + "</td>" +
              "<td>" + C.esc(e.domain) + "</td><td>" + C.esc(e.cadence) + "</td>" +
              '<td class="num">' + e.recordsToday + '</td><td class="num">' + e.entitiesExtracted + '</td><td class="num">' + e.edgesWritten + "</td>" +
              '<td class="num">' + e.parseMs + "ms</td><td>" + C.fmt.rel(e.lastAt) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:2">' + C.card({
        title: "Records ingested today",
        note: "per source",
        icon: "bi-bar-chart",
        body: Ch.bars({
          labels: (d.events || []).map(function (e) { return e.id; }),
          height: 226,
          series: [
            { name: "Records", color: C.hue("mint"), values: (d.events || []).map(function (e) { return e.recordsToday; }) },
            { name: "Entities", color: C.hue("blue"), values: (d.events || []).map(function (e) { return e.entitiesExtracted; }) },
            { name: "Edges", color: C.hue("violet"), values: (d.events || []).map(function (e) { return e.edgesWritten; }) }
          ],
          aria: "Ingestion volume by source"
        })
      }) + "</div>";

      out += '<div class="c12" style="--i:3">' + C.card({
        title: "Upstream provenance",
        note: "which panels are live vs. deterministic fallback",
        icon: "bi-shield-check",
        body: '<div class="chip-row">' + (d.provenance || []).map(function (p) {
          return '<span class="chip ' + (p.live ? "is-active" : "") + '">' + C.esc(p.source) + " · " + C.esc(p.detail || (p.live ? "live" : "fallback")) + "</span>";
        }).join("") + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };

  /* ══════════════════ SAAS ══════════════════ */
  V.saas = {
    icon: "bi-briefcase",
    label: "SaaS Model",
    title: "Multi-sided SaaS",
    load: function () { return C.api("/saas"); },
    render: function (env) {
      var d = env.data;
      var out = C.viewHead(
        "Part 6 · monetisation engine",
        "Multi-Sided SaaS Model",
        "The consumer product is the data-graph flywheel; the B2B/B2G verifiable-proof and aggregate-insight products are the monetisation engine — all on infrastructure that costs nothing per individual user."
      );

      out += '<div class="bento">';

      out += '<div class="c4" style="--i:0">' + C.card({
        title: "Modelled ARR",
        note: "derived from live segment counts",
        icon: "bi-graph-up-arrow",
        body:
          '<p class="kpi-value" style="font-size:34px">$' + C.fmt.compact(d.arr) + "</p>" +
          '<p class="card-note">infrastructure cost per user: $' + C.fmt.num(d.infraCostPerUser, 2) + "</p>" +
          '<div class="mt16">' + Ch.donut((d.segments || []).map(function (s, i) {
            var colors = [C.hue("mint"), C.hue("blue"), C.hue("violet"), C.hue("amber"), C.hue("rose")];
            var annual = s.id === "consumer" ? s.price * 12 * s.accounts * 0.06
              : s.id === "employer" ? s.price * 12 * s.accounts * 850
              : s.id === "insurer" ? s.price * s.accounts * 240000
              : s.price * s.accounts;
            return { label: s.segment, value: annual, color: colors[i % colors.length] };
          }), { center: "5", centerSub: "SEGMENTS" }) + "</div>"
      }) + "</div>";

      out += '<div class="c8" style="--i:1">' + C.card({
        title: "Revenue segments",
        note: "offering · model · unit economics",
        icon: "bi-diagram-3",
        body: '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Segment</th><th>Offering</th><th>Model</th><th class="num">Price</th><th class="num">Accounts</th></tr></thead><tbody>' +
          (d.segments || []).map(function (s) {
            return "<tr><td><b>" + C.esc(s.segment) + "</b></td><td>" + C.esc(s.offering) + "</td><td>" + C.esc(s.model) + "</td>" +
              '<td class="num">' + (s.price >= 1000 ? "$" + C.fmt.compact(s.price) : "$" + C.fmt.num(s.price, 2)) + " " + C.esc(s.unit) + "</td>" +
              '<td class="num">' + C.fmt.compact(s.accounts) + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<p class="row-sub mt12">' + C.esc(d.flywheel) + "</p>"
      }) + "</div>";

      out += '<div class="c12" style="--i:2">' + C.card({
        title: "Zero-dollar inference stack",
        note: "free-tier providers · keyed status is live",
        icon: "bi-cpu",
        body: '<div class="grid2">' + (d.stack || []).map(function (p) {
          return '<div class="stat-cell"><p class="stat-k">' + C.esc(p.label) + "</p>" +
            '<p class="stat-v" style="font-size:13px">' + C.esc(p.tier) + " tier <span class=\"badge " + (p.keyed ? "good" : "warn") + '" style="margin-left:6px">' +
            (p.keyed ? "keyed" : "no key") + "</span></p></div>";
        }).join("") + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };
})();
