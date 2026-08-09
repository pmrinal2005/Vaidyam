/**
 * verify.mjs — end-to-end verification for the Next.js Catena host.
 *
 * Suites:
 *   [1] NEXT API   — hits same-origin /api/* against a running server
 *   [2] ARTIFACTS  — required dashboard static assets exist
 *   [3] CONFIG     — vercel/next config cannot reintroduce dist-static
 *
 * Usage:
 *   BASE=http://localhost:3000 node scripts/verify.mjs
 *   node scripts/verify.mjs --no-api
 */
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const SKIP_API = process.argv.includes("--no-api");

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function ok(name, detail) {
  pass++;
  console.log(`  ${C.g("✓")} ${name}${detail ? " " + C.d(detail) : ""}`);
}
function bad(name, reason) {
  fail++;
  failures.push(`${name} — ${reason}`);
  console.log(`  ${C.r("✗")} ${name} ${C.r(String(reason))}`);
}
function skipped(name, reason) {
  skip++;
  console.log(`  ${C.y("–")} ${name} ${C.d(reason)}`);
}
function head(n) {
  console.log("\n" + C.b(n));
}

async function getJson(path) {
  const res = await fetch(BASE + path, {
    headers: { accept: "application/json", "x-catena-user": "verify-twin" },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

async function postJson(path, payload) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-catena-user": "verify-twin",
    },
    body: JSON.stringify(payload || {}),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

function checkEnvelope(name, status, body) {
  if (status !== 200) return bad(name, `HTTP ${status}`);
  if (!body || typeof body !== "object") return bad(name, "not JSON");
  if (body.ok !== true) return bad(name, `ok=${body.ok} ${body.error || ""}`);
  if (!("data" in body)) return bad(name, "missing data");
  ok(name, body.degraded ? "degraded ok" : `${body.ms || 0}ms`);
}

async function suiteConfig() {
  head("[1] CONFIG — no dist-static / static-export traps");

  const vercelPath = join(root, "vercel.json");
  if (!existsSync(vercelPath)) return bad("vercel.json", "missing");
  const vercel = JSON.parse(await readFile(vercelPath, "utf8"));

  if (vercel.outputDirectory) {
    bad(
      "vercel.json outputDirectory",
      `must be unset for Next.js (found "${vercel.outputDirectory}")`,
    );
  } else {
    ok("vercel.json outputDirectory", "unset (framework default)");
  }

  if (vercel.framework !== "nextjs") {
    bad("vercel.json framework", String(vercel.framework));
  } else {
    ok("vercel.json framework", "nextjs");
  }

  if (/dist-static/i.test(JSON.stringify(vercel))) {
    bad("vercel.json content", "still references dist-static");
  } else {
    ok("vercel.json content", "no dist-static");
  }

  const nextCfg = await readFile(join(root, "next.config.ts"), "utf8");
  // Only flag a real config assignment — ignore comments that mention the trap.
  if (/(^|\n)\s*output\s*:\s*['"]export['"]/.test(nextCfg)) {
    bad("next.config.ts", "static export would strip /api");
  } else {
    ok("next.config.ts", "no static export");
  }
  if (/distDir\s*:\s*['"]dist-static['"]/.test(nextCfg)) {
    bad("next.config.ts distDir", "dist-static");
  } else {
    ok("next.config.ts distDir", "default .next");
  }

  for (const gone of [
    "scripts/build-static.mjs",
    "scripts/serve-static.mjs",
    "public/dashboard.html",
    "public/index.html",
  ]) {
    if (existsSync(join(root, gone))) bad(gone, "must not exist");
    else ok(`${gone} absent`);
  }
}

async function suiteArtifacts() {
  head("[2] ARTIFACTS — dashboard static assets");
  const required = [
    "public/static/dash/core.js",
    "public/static/dash/app.js",
    "public/static/dash/charts.js",
    "public/static/dash/views-core.js",
    "public/static/dash/views-reason.js",
    "public/static/dash/views-domain.js",
    "public/static/dash/views-privacy.js",
    "public/static/dash/local-engine.js",
    "public/static/dashboard.css",
    "public/static/styles.css",
    "public/static/reveal/reveal.css",
    "src/app/dashboard/page.tsx",
    "src/app/api/health/route.ts",
    "src/app/api/overview/route.ts",
    "src/lib/vaidyam/api.ts",
  ];
  for (const rel of required) {
    const p = join(root, rel);
    if (!existsSync(p)) {
      bad(rel, "missing");
      continue;
    }
    const st = await stat(p);
    if (st.size < 20) bad(rel, "empty");
    else ok(rel, `${st.size}B`);
  }

  const core = await readFile(join(root, "public/static/dash/core.js"), "utf8");
  if (!core.includes('location.origin + "/api"') && !core.includes("location.origin + '/api'")) {
    bad("core.js same-origin", "does not prefer /api");
  } else {
    ok("core.js same-origin", "prefers /api");
  }
  if (/This build has no \/api worker \(static host\)/.test(core)) {
    bad("core.js message", "still ships static-host error copy");
  } else {
    ok("core.js message", "Next.js-oriented errors");
  }
}

async function suiteApi() {
  head("[3] NEXT API — live route handlers");
  if (SKIP_API) {
    skipped("api suite", "--no-api");
    return;
  }

  let health;
  try {
    health = await getJson("/api/health");
  } catch (err) {
    skipped("api suite", `server unreachable at ${BASE} (${err.message})`);
    return;
  }

  if (health.status !== 200 || health.body?.app !== "catena") {
    bad("/api/health", JSON.stringify(health.body).slice(0, 160));
    return;
  }
  ok("/api/health", `host=${health.body.host}`);

  const gets = [
    "/api/overview",
    "/api/graph",
    "/api/cascade",
    "/api/environment",
    "/api/medications",
    "/api/nutrition",
    "/api/public-health",
    "/api/memory",
    "/api/clinician-brief",
    "/api/ingestion",
    "/api/literature",
    "/api/saas",
    "/api/zk/claims",
    "/api/counterfactual/levers",
  ];
  for (const path of gets) {
    try {
      const { status, body } = await getJson(path);
      checkEnvelope(path, status, body);
    } catch (err) {
      bad(path, err.message);
    }
  }

  try {
    const { status, body } = await postJson("/api/swarm", {
      q: "why is my sleep affecting my BP?",
    });
    checkEnvelope("POST /api/swarm", status, body);
  } catch (err) {
    bad("POST /api/swarm", err.message);
  }

  try {
    const { status, body } = await postJson("/api/counterfactual", {
      interventions: { sleepHours: 8 },
      horizon: 60,
    });
    checkEnvelope("POST /api/counterfactual", status, body);
  } catch (err) {
    bad("POST /api/counterfactual", err.message);
  }
}

await suiteConfig();
await suiteArtifacts();
await suiteApi();

console.log(
  `\n${C.b("Result")}  ${C.g(pass + " passed")}  ${C.r(fail + " failed")}  ${C.y(skip + " skipped")}`,
);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(" -", f);
  process.exit(1);
}
