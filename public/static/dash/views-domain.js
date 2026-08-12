/* Views: Environmental Exposure, Medication, Nutrition, Clinician Brief. */
(function () {
  "use strict";
  var C = (window.Vaidyam = window.Vaidyam || {});
  var V = (C.views = C.views || {});
  var Ch = C.chart;

  /**
   * AQI heat-scale colour. `t` is the normalised cell intensity 0..1 used by
   * Ch.heat; optional absolute AQI `v` picks the band when provided.
   * Previously dead code — the heat() call inlined a one-off scale. Wired now.
   */
  function aqiColor(t, v) {
    var val = v === undefined || v === null ? (Number(t) || 0) * 200 : Number(v);
    var c;
    if (val <= 50) c = "110,231,245";       /* good — cyan */
    else if (val <= 100) c = "255,207,122";  /* moderate — amber */
    else if (val <= 150) c = "255,159,110";  /* unhealthy SG — orange */
    else if (val <= 200) c = "255,143,163";  /* unhealthy — rose */
    else c = "183,157,255";                 /* very unhealthy — violet */
    var a = (0.18 + Math.min(1, Math.max(0, Number(t) || 0)) * 0.72).toFixed(2);
    return "rgba(" + c + "," + a + ")";
  }

  /* ══════════════════ ENVIRONMENT ══════════════════ */
  V.environment = {
    icon: "bi-wind",
    label: "Environment",
    title: "Environmental Exposure",
    load: function () { return C.api("/environment"); },
    render: function (env) {
      var d = env.data;
      var cur = d.current || {};
      var hourly = d.hourly || [];
      var hLabels = hourly.map(function (h) { return String(h.time).slice(11, 16); });

      var bandTone = cur.aqi <= 50 ? "good" : cur.aqi <= 100 ? "warn" : "bad";

      var out = C.viewHead(
        "Environmental Exposure agent · live upstream",
        "Environmental Exposure",
        "Open-Meteo air-quality and weather are keyless and free, so exposure is ingested continuously rather than self-reported. The measured exposure→symptom edge below is what lets a respiratory flare be anticipated instead of explained after the fact. " +
        '<span class="mono" style="color:var(--accent-2)">' + C.esc(d.location.city + (d.location.region ? ", " + d.location.region : "")) + "</span> · " +
        '<span class="mono">' + C.fmt.num(d.location.lat, 2) + ", " + C.fmt.num(d.location.lon, 2) + "</span>",
        '<span class="badge ' + bandTone + '">AQI ' + C.fmt.num(cur.aqi, 0) + " · " + C.esc(cur.band || "") + "</span>" +
        '<span class="badge ' + (d.location.live ? "info" : "warn") + '">' + (d.location.live ? "geolocated" : "edge-inferred") + "</span>"
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Current exposure envelope",
        note: "pollutants + meteorology that drive the twin's symptom edges",
        icon: "bi-thermometer-half",
        body: '<div class="stat-strip">' +
          C.statCell("US AQI", C.fmt.num(cur.aqi, 0), "", C.tipModel("US AQI", [{ name: "AQI", value: C.fmt.num(cur.aqi, 0), color: C.hue("cyan") }, { name: "Band", value: String(cur.band || "—") }], "Open-Meteo")) +
          C.statCell("PM2.5", C.fmt.num(cur.pm25, 1), "µg/m³", true) +
          C.statCell("PM10", C.fmt.num(cur.pm10, 1), "µg/m³", true) +
          C.statCell("Ozone", C.fmt.num(cur.ozone, 0), "µg/m³", true) +
          C.statCell("NO₂", C.fmt.num(cur.no2, 1), "µg/m³", true) +
          C.statCell("SO₂", C.fmt.num(cur.so2, 1), "µg/m³", true) +
          C.statCell("CO", C.fmt.num(cur.co, 0), "µg/m³", true) +
          C.statCell("Pollen", C.fmt.num(cur.pollen, 0), "", true) +
          C.statCell("Temp", C.fmt.num(cur.temperature, 1), "°C", true) +
          C.statCell("Humidity", C.fmt.num(cur.humidity, 0), "%", true) +
          C.statCell("Pressure", C.fmt.num(cur.pressure, 0), "hPa", true) +
          C.statCell("UV index", C.fmt.num(cur.uv, 1), "", true) +
          "</div>"
      }) + "</div>";

      out += '<div class="c8" style="--i:1">' + C.card({
        title: "PM2.5 & AQI — 72h window",
        note: "past 24h measured + 48h forecast, hourly resolution",
        icon: "bi-graph-up",
        body: Ch.line({
          labels: hLabels,
          height: 250,
          xTicks: 8,
          rightAxis: true,
          series: [
            { name: "PM2.5 (µg/m³)", color: C.hue("cyan"), values: hourly.map(function (h) { return h.pm25; }) },
            { name: "US AQI", color: C.hue("amber"), values: hourly.map(function (h) { return h.aqi; }), area: false },
            { name: "Temp (°C)", color: C.hue("orange"), values: hourly.map(function (h) { return h.temperature; }), axis: "right", area: false, dashed: true }
          ],
          bands: [{ from: 35, to: 500, color: "rgba(255,143,163,0.06)" }],
          aria: "PM2.5, AQI and temperature over 72 hours"
        })
      }) + "</div>";

      out += '<div class="c4" style="--i:2">' + C.card({
        title: "Exposure → symptom coupling",
        note: "measured on this twin, not a population average",
        icon: "bi-link-45deg",
        body:
          '<div class="stat-strip">' +
          C.statCell("PM2.5 → symptom", C.fmt.num(d.correlation.pm25ToSymptom, 2), "r", true) +
          C.statCell("PM2.5 → SpO₂", C.fmt.num(d.correlation.pm25ToSpo2, 2), "r", true) +
          C.statCell("PM2.5 → steps", C.fmt.num(d.correlation.pm25ToSteps, 2), "r", true) +
          C.statCell("Edge strength", C.fmt.num(d.correlation.edgeStrength, 3), "", true) +
          "</div>" +
          '<p class="card-note mt12">Causal lag <b class="mono" style="color:var(--accent)">' + C.fmt.num(d.correlation.lagHours, 0) +
          "h</b> — the interval between an exposure spike and symptom expression in this individual. Forecast risk below uses this edge, so the warning arrives before the flare.</p>" +
          '<div class="mt12">' + Ch.gauge(Math.abs(d.correlation.pm25ToSymptom) * 100, { sub: "COUPLING", color: C.hue("cyan") }) + "</div>"
      }) + "</div>";

      out += '<div class="c12" style="--i:3">' + C.card({
        title: "48-hour forecast symptom risk",
        note: "forecast PM2.5 × this twin's exposure edge → projected respiratory symptom load",
        icon: "bi-calendar-week",
        body: Ch.heat({
          cells: (d.forecastRisk || []).map(function (f) {
            return { label: String(f.hour).slice(5, 16) + " · PM2.5 " + C.fmt.num(f.pm25, 1), value: f.symptomRisk, tick: String(f.hour).slice(11, 13) + "h" };
          }),
          cellH: 40,
          scale: function (t) { return aqiColor(t); },
          aria: "Forecast symptom risk by hour"
        }) +
          '<div class="mt12">' + Ch.line({
            labels: (d.forecastRisk || []).map(function (f) { return String(f.hour).slice(11, 16); }),
            height: 190, xTicks: 8,
            series: [
              { name: "Forecast PM2.5", color: C.hue("cyan"), values: (d.forecastRisk || []).map(function (f) { return f.pm25; }) },
              { name: "Projected symptom load (/10)", color: C.hue("rose"), values: (d.forecastRisk || []).map(function (f) { return f.symptomRisk; }), axis: "right", area: false }
            ],
            rightAxis: true,
            aria: "Forecast PM2.5 and projected symptom load"
          }) + "</div>"
      }) + "</div>";

      out += '<div class="c6" style="--i:4">' + C.card({
        title: "Meteorological pressure & humidity",
        note: "barometric shifts couple to migraine / joint symptom edges",
        icon: "bi-speedometer",
        body: Ch.line({
          labels: hLabels, height: 214, xTicks: 6, rightAxis: true,
          series: [
            { name: "Pressure (hPa)", color: C.hue("violet"), values: hourly.map(function (h) { return h.pressure; }) },
            { name: "Humidity (%)", color: C.hue("blue"), values: hourly.map(function (h) { return h.humidity; }), axis: "right", area: false, dashed: true }
          ],
          aria: "Surface pressure and humidity"
        })
      }) + "</div>";

      out += '<div class="c6" style="--i:5">' + C.card({
        title: "Daily outlook",
        note: "Open-Meteo daily aggregation — temperature range and UV",
        icon: "bi-sun",
        body: Ch.bars({
          labels: (d.daily.time || []).map(function (t) { return C.fmt.day(t); }),
          height: 214,
          series: [
            { name: "Max °C", color: C.hue("orange"), values: d.daily.tMax || [] },
            { name: "Min °C", color: C.hue("blue"), values: d.daily.tMin || [] },
            { name: "UV index", color: C.hue("amber"), values: d.daily.uv || [] }
          ],
          aria: "Daily temperature range and UV index"
        }) +
          '<div class="chip-row mt12">' +
          '<span class="chip">precipitation ' + C.fmt.num(cur.precipitation, 1) + " mm</span>" +
          '<span class="chip">wind ' + C.fmt.num(cur.windSpeed, 1) + " km/h</span>" +
          '<span class="chip">' + C.esc(cur.band || "") + " air</span>" +
          "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };

  /* ══════════════════ MEDICATION ══════════════════ */
  V.medication = {
    icon: "bi-capsule",
    label: "Medication",
    title: "Medication & Adherence",
    load: function () { return C.api("/medications"); },
    render: function (env) {
      var d = env.data;
      var meds = d.medications || [];
      var tl = d.timeline || [];
      var st = d.adherenceStats || {};

      var out = C.viewHead(
        "Medication agent · openFDA grounded",
        "Medication, Adherence & Safety",
        "Adverse-event and label signals come live from openFDA, so interaction warnings reflect real post-market reports rather than a static table. Adherence is treated as a causal input — the measured adherence→BP edge is what turns a missed-dose pattern into a forecastable outcome.",
        '<span class="badge ' + (st.mean30 >= 90 ? "good" : st.mean30 >= 78 ? "warn" : "bad") + '">30d adherence ' + C.fmt.num(st.mean30, 0) + "%</span>" +
        '<button type="button" class="btn btn-sm" data-goto="privacy"><i class="bi bi-shield-lock"></i> Prove adherence with zk</button>'
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Adherence posture",
        note: "lapse days are what the swarm escalates on",
        icon: "bi-clipboard2-pulse",
        body: '<div class="stat-strip">' +
          C.statCell("7-day mean", C.fmt.num(st.mean7, 0), "%") +
          C.statCell("30-day mean", C.fmt.num(st.mean30, 0), "%") +
          C.statCell("Lapse days (<80%)", st.lapseDays) +
          C.statCell("Current streak ≥90%", st.streak, "d") +
          C.statCell("Active regimens", meds.length) +
          C.statCell("Interaction flags", (d.interactions || []).length) +
          "</div>"
      }) + "</div>";

      out += '<div class="c8" style="--i:1">' + C.card({
        title: "Adherence → blood pressure, with symptom expression",
        note: d.adherenceEdge
          ? "measured edge: strength " + C.fmt.num(d.adherenceEdge.strength, 3) + " · lag " + d.adherenceEdge.lagHours + "h · confidence " + C.fmt.num(d.adherenceEdge.confidence, 2)
          : "no adherence→BP edge inferred yet",
        icon: "bi-activity",
        body: Ch.line({
          labels: tl.map(function (t) { return C.fmt.dayShort(t.day); }),
          height: 250, rightAxis: true,
          series: [
            { name: "Adherence (%)", color: C.hue("mint"), values: tl.map(function (t) { return t.adherence; }) },
            { name: "Systolic (mmHg)", color: C.hue("rose"), values: tl.map(function (t) { return t.systolic; }), axis: "right", area: false },
            { name: "Symptom load (/10)", color: C.hue("amber"), values: tl.map(function (t) { return t.symptomLoad * 10; }), area: false, dashed: true }
          ],
          aria: "Adherence versus systolic blood pressure"
        })
      }) + "</div>";

      out += '<div class="c4" style="--i:2">' + C.card({
        title: "Regimen",
        note: "dose · schedule · refill horizon",
        icon: "bi-capsule-pill",
        body: '<div class="row-list scroll-y">' + meds.map(function (m) {
          return '<div class="row"><div class="row-main">' +
            '<p class="row-title">' + C.esc(m.name) + ' <span class="muted tiny">' + C.esc(m.dose) + "</span></p>" +
            '<p class="row-sub">' + C.esc(m.class) + " · " + C.esc(m.schedule) + " · started " + m.startedDaysAgo + "d ago</p>" +
            '<div class="mt8">' + C.bar(m.adherence, m.adherence >= 90 ? "" : m.adherence >= 78 ? "warn" : "bad") + "</div>" +
            '<p class="row-sub mono">next ' + C.fmt.time(m.nextDue) + " · refill in " + m.refillInDays + "d</p>" +
            "</div><span class=\"row-value\">" + m.adherence + "%</span></div>";
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:3">' + C.card({
        title: "openFDA adverse-event signal",
        note: "top reported reactions per molecule — live FAERS counts",
        icon: "bi-exclamation-triangle",
        body: '<div class="row-list scroll-y">' + meds.map(function (m) {
          var s = m.signal || { topReactions: [], totalReports: 0, live: false };
          return '<div class="row"><div class="row-main">' +
            '<p class="row-title">' + C.esc(m.name) + " <span class=\"muted tiny mono\">" + C.esc(m.generic) + "</span>" +
            ' <span class="badge ' + (s.live ? "good" : "warn") + '" style="margin-left:6px">' + (s.live ? "live" : "cached") + "</span>" +
            (s.boxedWarning ? ' <span class="badge bad" style="margin-left:4px">boxed warning</span>' : "") + "</p>" +
            '<p class="row-sub">' + C.fmt.compact(s.totalReports) + " reports in FAERS</p>" +
            '<div class="chip-row mt8">' + (s.topReactions || []).slice(0, 6).map(function (r) {
              return '<span class="chip">' + C.esc(String(r.term).toLowerCase()) + " · " + C.fmt.num(r.share, 1) + "%</span>";
            }).join("") + "</div>" +
            "</div></div>";
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:4">' + C.card({
        title: "Interaction surface",
        note: "pairs sharing adverse-event terms across openFDA reports",
        icon: "bi-shuffle",
        body: (d.interactions || []).length
          ? '<div class="row-list scroll-y">' + d.interactions.map(function (it) {
              return '<div class="row"><div class="row-main">' +
                '<p class="row-title">' + C.esc(it.a) + ' <span class="muted">×</span> ' + C.esc(it.b) + "</p>" +
                '<p class="row-sub">' + C.esc(it.note) + "</p></div>" +
                '<span class="badge ' + (it.severity === "monitor closely" ? "bad" : "warn") + '">' + C.esc(it.severity) + "</span></div>";
            }).join("") + "</div>"
          : '<p class="empty">No shared adverse-event terms across the active regimen.</p>'
      }) + "</div>";

      out += '<div class="c12" style="--i:5">' + C.card({
        title: "Reported reaction distribution",
        note: "aggregate share of top terms across the regimen",
        icon: "bi-bar-chart",
        body: (function () {
          var agg = {};
          meds.forEach(function (m) {
            ((m.signal || {}).topReactions || []).forEach(function (r) {
              agg[r.term] = (agg[r.term] || 0) + r.count;
            });
          });
          var rows = Object.keys(agg).map(function (k) { return { label: String(k).toLowerCase(), value: agg[k] }; })
            .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
          if (!rows.length) return '<p class="empty">openFDA upstream unavailable — adherence reasoning is unaffected.</p>';
          var max = rows[0].value;
          return Ch.hbars(rows.map(function (r) {
            return { label: r.label, value: (r.value / max) * 100, display: C.fmt.compact(r.value), cls: "cool" };
          }), { max: 100 });
        })()
      }) + "</div>";

      out += "</div>";
      return out;
    }
  };

  /* ══════════════════ NUTRITION ══════════════════ */
  V.nutrition = {
    icon: "bi-egg-fried",
    label: "Nutrition",
    title: "Nutrition & Sodium",
    load: function () { return C.api("/nutrition", { q: C.state.foodQuery }); },
    render: function (env) {
      var d = env.data;
      var t = d.totals || {};
      var g = d.targets || {};
      var ss = d.sodiumSeries || [];

      var macroRows = [
        { key: "kcal", label: "Energy", unit: "kcal" },
        { key: "protein", label: "Protein", unit: "g" },
        { key: "carbs", label: "Carbohydrate", unit: "g" },
        { key: "fat", label: "Fat", unit: "g" },
        { key: "fiber", label: "Fibre", unit: "g" },
        { key: "sodium", label: "Sodium", unit: "mg" },
        { key: "sugar", label: "Sugar", unit: "g" },
        { key: "potassium", label: "Potassium", unit: "mg" }
      ];

      var out = C.viewHead(
        "Nutrition agent · USDA FoodData Central",
        "Nutrition & Sodium Load",
        "Nutrient values resolve live against USDA FoodData Central rather than a hard-coded table. The sodium→BP edge below is measured on this twin's own series, which is why the counterfactual engine can quantify a sodium reduction instead of merely advising one.",
        '<span class="badge ' + (t.sodium <= g.sodium ? "good" : "bad") + '">sodium ' + C.fmt.compact(t.sodium) + " / " + C.fmt.compact(g.sodium) + " mg</span>" +
        '<button type="button" class="btn btn-sm btn-primary" data-goto="counterfactual"><i class="bi bi-sliders"></i> Simulate sodium cut</button>'
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        title: "Log a food — resolved live against USDA",
        note: "comma-separated; each term is matched to a Foundation / SR Legacy / FNDDS record",
        icon: "bi-search",
        body:
          '<div class="wrapgap">' +
          '<input type="text" id="food-input" class="food-input" placeholder="rolled oats, greek yogurt, grilled salmon" value="' +
          C.esc(C.state.foodQuery || "") + '" aria-label="Foods to resolve against USDA FoodData Central" />' +
          '<button type="button" class="btn btn-sm btn-primary" id="food-go"><i class="bi bi-arrow-return-left"></i> Resolve</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" id="food-reset"><i class="bi bi-arrow-counterclockwise"></i> Default day</button>' +
          "</div>" +
          '<div class="stat-strip mt12">' + macroRows.map(function (m) {
            return C.statCell(m.label, C.fmt.num(t[m.key], m.key === "kcal" || m.key === "sodium" || m.key === "potassium" ? 0 : 1), m.unit);
          }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:1">' + C.card({
        title: "Target attainment",
        note: "logged intake vs. the twin's daily targets",
        icon: "bi-bullseye",
        body: Ch.hbars(macroRows.map(function (m) {
          var pct = g[m.key] ? (t[m.key] / g[m.key]) * 100 : 0;
          var over = m.key === "sodium" || m.key === "sugar";
          return {
            label: m.label,
            value: Math.min(100, pct),
            display: C.fmt.num(pct, 0) + "%",
            sub: C.fmt.num(t[m.key], 0) + " / " + C.fmt.num(g[m.key], 0) + " " + m.unit,
            cls: over ? (pct > 100 ? "bad" : pct > 80 ? "warn" : "") : pct >= 80 ? "" : pct >= 55 ? "warn" : "bad"
          };
        }), { max: 100 }) +
          '<div class="stat-strip mt12">' +
          C.statCell("Na:K ratio", C.fmt.num(d.naKRatio, 2)) +
          C.statCell("Target", "< 1.00") +
          "</div>" +
          '<p class="card-note mt8">A Na:K ratio above 1.0 is more predictive of blood-pressure response than sodium alone, which is why both are tracked as separate graph entities.</p>'
      }) + "</div>";

      out += '<div class="c7" style="--i:2">' + C.card({
        title: "Sodium load → systolic BP",
        note: d.sodiumEdge
          ? "measured edge: strength " + C.fmt.num(d.sodiumEdge.strength, 3) + " · lag " + d.sodiumEdge.lagHours + "h"
          : "no sodium→BP edge inferred yet",
        icon: "bi-droplet-half",
        body: Ch.line({
          labels: ss.map(function (s) { return C.fmt.dayShort(s.day); }),
          height: 244, rightAxis: true,
          series: [
            { name: "Sodium (mg)", color: C.hue("amber"), values: ss.map(function (s) { return s.sodium; }) },
            { name: "Systolic (mmHg)", color: C.hue("rose"), values: ss.map(function (s) { return s.systolic; }), axis: "right", area: false }
          ],
          aria: "Sodium intake versus systolic blood pressure"
        })
      }) + "</div>";

      out += '<div class="c7" style="--i:3">' + C.card({
        title: "Resolved food records",
        note: "per-100g values straight from USDA — brand blank means a Foundation record",
        icon: "bi-basket",
        body: '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Food</th><th class="num">kcal</th><th class="num">Protein</th><th class="num">Carbs</th><th class="num">Fat</th><th class="num">Fibre</th><th class="num">Na</th><th class="num">K</th><th>Src</th></tr></thead><tbody>' +
          (d.foods || []).map(function (f) {
            return "<tr><td>" + C.esc(f.name) + (f.brand ? ' <span class="muted tiny">' + C.esc(f.brand) + "</span>" : "") + "</td>" +
              '<td class="num">' + C.fmt.num(f.kcal, 0) + '</td><td class="num">' + C.fmt.num(f.protein, 1) + "</td>" +
              '<td class="num">' + C.fmt.num(f.carbs, 1) + '</td><td class="num">' + C.fmt.num(f.fat, 1) + "</td>" +
              '<td class="num">' + C.fmt.num(f.fiber, 1) + '</td><td class="num">' + C.fmt.num(f.sodium, 0) + "</td>" +
              '<td class="num">' + C.fmt.num(f.potassium, 0) + "</td>" +
              '<td><span class="badge ' + (f.live ? "good" : "warn") + '">' + (f.live ? "USDA" : "est") + "</span></td></tr>";
          }).join("") + "</tbody></table></div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:4">' + C.card({
        title: "Macro split & hydration",
        note: "energy contribution by macronutrient",
        icon: "bi-pie-chart",
        body: Ch.donut([
          { label: "Protein", value: (t.protein || 0) * 4, color: C.hue("mint") },
          { label: "Carbs", value: (t.carbs || 0) * 4, color: C.hue("blue") },
          { label: "Fat", value: (t.fat || 0) * 9, color: C.hue("amber") }
        ], { center: C.fmt.compact(t.kcal), centerSub: "KCAL" }) +
          '<div class="mt12">' + Ch.line({
            labels: (d.hydrationSeries || []).map(function (h) { return C.fmt.dayShort(h.day); }),
            height: 140, legend: false, xTicks: 5,
            series: [{ name: "Hydration (ml)", color: C.hue("cyan"), values: (d.hydrationSeries || []).map(function (h) { return h.ml; }) }],
            aria: "Daily hydration"
          }) + "</div>"
      }) + "</div>";

      out += "</div>";
      return out;
    },
    after: function () {
      var input = C.$("#food-input");
      var go = C.$("#food-go");
      function submit() {
        C.state.foodQuery = input ? input.value.trim() : "";
        C.load("nutrition");
      }
      if (go) go.addEventListener("click", submit);
      if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      var reset = C.$("#food-reset");
      if (reset) reset.addEventListener("click", function () { C.state.foodQuery = ""; C.load("nutrition"); });
    }
  };

  /* ══════════════════ CLINICIAN BRIEF ══════════════════ */
  V.clinician = {
    icon: "bi-file-earmark-medical",
    label: "Clinician",
    title: "Clinician Brief",
    load: function () { return C.api("/clinician-brief"); },
    render: function (env) {
      var d = env.data;
      var flagTone = { high: "bad", watch: "warn", normal: "good" };

      var out = C.viewHead(
        "Layer 6 · pre-visit causal summary",
        "Clinician Brief",
        "A consultation opens with causal structure instead of a raw data dump — dominant chains, measured lags and the exact adherence window, so the clinician spends the visit deciding rather than reconstructing.",
        '<button type="button" class="btn btn-sm" id="brief-print"><i class="bi bi-printer"></i> Print / PDF</button>' +
        '<button type="button" class="btn btn-sm btn-primary" id="brief-copy"><i class="bi bi-clipboard"></i> Copy brief</button>'
      );

      out += '<div class="bento">';

      out += '<div class="c12" style="--i:0">' + C.card({
        cls: "is-flat",
        body: '<div class="stat-strip">' +
          C.statCell("Twin", '<span class="mono" style="font-size:12px">' + C.esc(d.header.twin) + "</span>") +
          C.statCell("Graph version", '<span class="mono" style="font-size:12px">' + C.esc(d.header.graphVersion) + "</span>") +
          C.statCell("Window", '<span style="font-size:12px">' + C.esc(d.header.window) + "</span>") +
          C.statCell("Generated", '<span style="font-size:12px">' + C.fmt.time(d.header.generatedAt) + "</span>") +
          "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:1">' + C.card({
        title: "Vital summary — 14-day means",
        note: "flags follow standard clinical thresholds",
        icon: "bi-heart-pulse",
        body: '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Measure</th><th class="num">Value</th><th>Unit</th><th>Flag</th></tr></thead><tbody>' +
          (d.vitalSummary || []).map(function (v) {
            return "<tr><td>" + C.esc(v.label) + '</td><td class="num"><b>' + C.fmt.num(v.value, 1) + "</b></td>" +
              "<td>" + C.esc(v.unit) + '</td><td><span class="badge ' + (flagTone[v.flag] || "") + '">' + C.esc(v.flag) + "</span></td></tr>";
          }).join("") + "</tbody></table></div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:2">' + C.card({
        title: "Risk register",
        note: "graph-weighted, multi-horizon",
        icon: "bi-radar",
        body: Ch.hbars((d.risks || []).slice().sort(function (a, b) { return b.score - a.score; }).map(function (r) {
          return {
            label: r.label, value: r.score, display: r.score + " · " + r.horizon,
            sub: r.drivers ? "drivers: " + r.drivers.join(", ") : "",
            cls: r.score < 34 ? "" : r.score < 62 ? "warn" : "bad"
          };
        }), { max: 100 })
      }) + "</div>";

      out += '<div class="c7" style="--i:3">' + C.card({
        title: "Dominant causal chains",
        note: "ranked by strength × confidence over this twin's series",
        icon: "bi-diagram-3",
        body: '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Chain</th><th>Relation</th><th class="num">Strength</th><th class="num">Lag</th><th class="num">Conf</th></tr></thead><tbody>' +
          (d.causalChains || []).map(function (ch) {
            return "<tr><td>" + C.esc(ch.chain) + '</td><td class="mono" style="color:var(--accent-2)">' + C.esc(ch.relation) + "</td>" +
              '<td class="num">' + C.fmt.num(ch.strength, 3) + '</td><td class="num">' + ch.lagHours + "h</td>" +
              '<td class="num">' + C.fmt.num(ch.confidence, 2) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
      }) + "</div>";

      out += '<div class="c5" style="--i:4">' + C.card({
        title: "Active regimen",
        note: "as reconciled from pharmacy feed + self-report",
        icon: "bi-capsule",
        body: '<div class="row-list">' + (d.medications || []).map(function (m) {
          return '<div class="row"><div class="row-main"><p class="row-title">' + C.esc(m.name) + ' <span class="muted tiny">' + C.esc(m.dose) + "</span></p>" +
            '<p class="row-sub">' + C.esc(m.class) + " · " + C.esc(m.schedule) + "</p></div>" +
            '<span class="badge ' + (m.adherence >= 90 ? "good" : m.adherence >= 78 ? "warn" : "bad") + '">' + m.adherence + "%</span></div>";
        }).join("") + "</div>"
      }) + "</div>";

      out += '<div class="c7" style="--i:5">' + C.card({
        title: "Talking points",
        note: "what to open the consultation with",
        icon: "bi-chat-square-quote",
        id: "brief-points",
        body: '<ol class="brief-list">' + (d.talkingPoints || []).map(function (p) {
          return "<li>" + C.esc(p) + "</li>";
        }).join("") + "</ol>" +
          '<p class="card-note mt12"><i class="bi bi-info-circle"></i> ' + C.esc(d.disclaimer) + "</p>"
      }) + "</div>";

      out += '<div class="c5" style="--i:6">' + C.card({
        title: "Literature grounding",
        note: "live PubMed E-utilities for the leading risk + behavioural driver",
        icon: "bi-journal-medical",
        body: (d.citations || []).length
          ? '<div class="row-list scroll-y">' + d.citations.map(function (cit) {
              return '<a class="row" href="' + C.esc(cit.url) + '" target="_blank" rel="noopener noreferrer">' +
                '<div class="row-main"><p class="row-title">' + C.esc(cit.title) + "</p>" +
                '<p class="row-sub">' + C.esc(cit.journal) + " · " + C.esc(cit.year) + (cit.pmid ? " · PMID " + C.esc(cit.pmid) : "") + "</p></div>" +
                '<i class="bi bi-box-arrow-up-right muted"></i></a>';
            }).join("") + "</div>"
          : '<p class="empty">PubMed upstream unavailable right now.</p>'
      }) + "</div>";

      out += "</div>";
      return out;
    },
    after: function () {
      var p = C.$("#brief-print");
      if (p) p.addEventListener("click", function () { window.print(); });
      var cp = C.$("#brief-copy");
      if (cp) cp.addEventListener("click", function () {
        var env = C.state.cache.clinician;
        if (!env) return;
        var d = env.data;
        var lines = ["CATENA CLINICIAN BRIEF", "twin " + d.header.twin + " · graph " + d.header.graphVersion, "window " + d.header.window, ""];
        lines.push("VITALS (14d mean)");
        (d.vitalSummary || []).forEach(function (v) { lines.push("  " + v.label + ": " + v.value + " " + v.unit + " [" + v.flag + "]"); });
        lines.push("", "MEDICATIONS");
        (d.medications || []).forEach(function (m) { lines.push("  " + m.name + " " + m.dose + " " + m.schedule + " — adherence " + m.adherence + "%"); });
        lines.push("", "CAUSAL CHAINS");
        (d.causalChains || []).forEach(function (ch) { lines.push("  " + ch.chain + " (" + ch.relation + ", " + ch.lagHours + "h, s=" + ch.strength + ")"); });
        lines.push("", "TALKING POINTS");
        (d.talkingPoints || []).forEach(function (t, i) { lines.push("  " + (i + 1) + ". " + t); });
        lines.push("", d.disclaimer);
        var text = lines.join("\n");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { C.toast("Clinician brief copied to clipboard"); },
            function () { C.toast("Clipboard blocked by the browser"); });
        } else {
          C.toast("Clipboard unavailable in this browser");
        }
      });
    }
  };
})();
