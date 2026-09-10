// Server-side smoke test for the Pro wall (dev only, no DB needed): boots server.js twice —
// once dormant (default) and once with PRO_ENFORCE=1 — and proves the wall only exists when asked for.
//   node smoke-server.js
const { spawn } = require("child_process");
const crypto = require("crypto");

const results = [];
const T = async (name, fn) => { try { await fn(); results.push("✓ " + name); } catch (e) { results.push("✗ " + name + " — " + e.message); } };

function boot(env, port) {
  const p = spawn(process.execPath, ["server.js"], { env: { ...process.env, ...env, PORT: String(port), ANTHROPIC_API_KEY: "", DATABASE_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d));
  const base = "http://127.0.0.1:" + port;
  const ready = (async () => {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(base + "/api/health"); if (r.ok) return; } catch (e) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("server did not start:\n" + log);
  })();
  return { p, base, ready, log: () => log };
}
const chat = (base, feature, extraHeaders = {}) =>
  fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", ...extraHeaders }, body: JSON.stringify({ messages: [{ role: "user", content: "ciao" }], system: "x", max_tokens: 10, feature }) });
const sign = (secret, body) => crypto.createHmac("sha256", secret).update(body).digest("hex");

(async () => {
  const dormant = boot({ PRO_ENFORCE: "" }, 3911);
  const walled = boot({ PRO_ENFORCE: "1", CHECKOUT_URL: "https://buy.test/fluente", MOR_WEBHOOK_SECRET: "s3cret", CRON_KEY: "k3y" }, 3912);
  try {
    await Promise.all([dormant.ready, walled.ready]);

    await T("dormant: /api/plan says enforce:false and no checkout", async () => {
      const d = await (await fetch(dormant.base + "/api/plan")).json();
      if (d.enforce !== false || d.checkoutUrl !== "" || d.plan !== "free") throw new Error(JSON.stringify(d));
    });
    await T("dormant: a Pro feature is NOT refused (request reaches the API-key check, not a 402)", async () => {
      const r = await chat(dormant.base, "esame_scritta"); const d = await r.json();
      if (r.status === 402) throw new Error("walled while dormant");
      if (r.status !== 500 || !/ANTHROPIC_API_KEY/.test(d.error.message)) throw new Error(r.status + " " + JSON.stringify(d));
    });
    await T("dormant: free-tier daily allowance is not counted either (coach ×3 all pass the wall)", async () => {
      for (let i = 0; i < 3; i++) { const r = await chat(dormant.base, "coach"); if (r.status === 402) throw new Error("capped while dormant on call " + (i + 1)); }
    });
    await T("dormant: webhook reports 503 (no MOR_WEBHOOK_SECRET) instead of pretending", async () => {
      const r = await fetch(dormant.base + "/api/webhook/mor", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.status !== 503) throw new Error("status " + r.status);
    });

    await T("enforced: /api/plan says enforce:true with the checkout link", async () => {
      const d = await (await fetch(walled.base + "/api/plan")).json();
      if (d.enforce !== true || d.checkoutUrl !== "https://buy.test/fluente" || d.signedIn !== false) throw new Error(JSON.stringify(d));
    });
    await T("enforced: Pro feature → 402 pro_required with the feature name and checkout link", async () => {
      const r = await chat(walled.base, "esame_scritta"); const d = await r.json();
      if (r.status !== 402) throw new Error("status " + r.status);
      if (d.error.code !== "pro_required" || d.error.feature !== "esame_scritta" || d.checkoutUrl !== "https://buy.test/fluente") throw new Error(JSON.stringify(d));
    });
    await T("enforced: all four prove + plateau/packs/mental/accent7/lesson_ai are walled", async () => {
      for (const f of ["esame_orale", "esame_ascolto", "esame_lettura", "plateau", "packs", "mental", "accent7", "lesson_ai"]) {
        const r = await chat(walled.base, f); if (r.status !== 402) throw new Error(f + " → " + r.status);
      }
    });
    await T("enforced: habit features stay free (parla passes) and untagged calls are never walled", async () => {
      for (const f of ["parla", "grammar", "ripara", ""]) { const r = await chat(walled.base, f); if (r.status === 402) throw new Error(f + " walled"); if (r.status !== 500) throw new Error(f + " → " + r.status); }
    });
    await T("enforced: free daily allowance — coach passes once, then 402 with the limit message", async () => {
      const r1 = await chat(walled.base, "coach"); if (r1.status !== 500) throw new Error("first coach → " + r1.status);
      const r2 = await chat(walled.base, "coach"); const d = await r2.json();
      if (r2.status !== 402 || !/Limite gratuito/.test(d.error.message)) throw new Error(r2.status + " " + JSON.stringify(d));
    });
    await T("enforced: an unknown bearer token is treated as anonymous, not as an error", async () => {
      const r = await chat(walled.base, "parla", { Authorization: "Bearer nope" }); if (r.status !== 500) throw new Error("status " + r.status);
    });
    await T("webhook: wrong signature → 401 before anything else is looked at", async () => {
      const body = JSON.stringify({ meta: { event_name: "subscription_created", custom_data: { username: "farwa" } }, data: { attributes: { renews_at: "2030-01-01T00:00:00Z" } } });
      const r = await fetch(walled.base + "/api/webhook/mor", { method: "POST", headers: { "content-type": "application/json", "x-signature": sign("wrong", body) }, body });
      if (r.status !== 401) throw new Error("status " + r.status);
    });
    await T("webhook: correct signature is accepted (then 503 here only because this test has no DB)", async () => {
      const body = JSON.stringify({ meta: { event_name: "subscription_created", custom_data: { username: "farwa" } }, data: { attributes: { renews_at: "2030-01-01T00:00:00Z" } } });
      const r = await fetch(walled.base + "/api/webhook/mor", { method: "POST", headers: { "content-type": "application/json", "x-signature": sign("s3cret", body) }, body });
      const d = await r.json();
      if (r.status !== 503 || !/no DB/.test(d.error.message)) throw new Error(r.status + " " + JSON.stringify(d));
    });
    await T("telegram: composer fills the bank — brutale vs gentile, weekly report, deep link", () => {
      const srv = require("./server.js");
      const req = { headers: { host: "app.test", "x-forwarded-proto": "https" } };
      const row = { username: "farwa", state: { name: "Farwa", brutale: true, streak: 4, streakBest: 9, prefs: { slot: "07:30", anchor: "prima del turno", tz: "Europe/Rome" }, xpLog: { "2026-09-09": 40 }, errLog: { preposizioni: { n: 3 } }, deck: [{ due: 1 }, { due: 9e15 }], goal: { target: "B2", examDate: "2026-12-10" } } };
      const slot = srv.composeNudge("slot", row, req, "2026-09-10");
      if (!/https:\/\/app\.test\/\?go=micro/.test(slot)) throw new Error("no deep link: " + slot);
      if (!/cazzo|gatto|Instagram|rovinargliela/.test(slot)) throw new Error("not from brutale bank: " + slot);
      if (/\{\w+\}/.test(slot)) throw new Error("unfilled placeholder: " + slot);
      const gentle = srv.composeNudge("evening", { username: "ana", state: { streak: 2 } }, req, "2026-09-10");
      if (!/sessione minima|Sono le 21|non saltare due volte/.test(gentle) || /cazzo|cavolo/.test(gentle)) throw new Error("not from gentile bank: " + gentle);
      const weekly = srv.composeNudge("weekly", row, req, "2026-09-14");
      if (!/Pagella/.test(weekly) || !/Streak: 4 \(record 9\)/.test(weekly) || !/le preposizioni/.test(weekly) || !/giorni all'esame B2/.test(weekly) || !/07:30 prima del turno/.test(weekly)) throw new Error("weekly: " + weekly);
      const welcome = srv.composeNudge("welcome", row, req, "2026-09-10");
      if (!/07:30 prima del turno/.test(welcome)) throw new Error("welcome: " + welcome);
      const st = srv.composeNudge("status", row, req, "2026-09-09");
      if (!/1 carte/.test(st) || !/fatto ✓/.test(st)) throw new Error("status: " + st);
      if (srv.localDay(new Date("2026-09-10T22:30:00Z"), "Europe/Rome") !== "2026-09-11") throw new Error("localDay tz");
      if (srv.localHour(new Date("2026-09-10T06:05:00Z"), "Europe/Rome") !== 8) throw new Error("localHour tz");
      if (srv.localDow(new Date("2026-09-14T10:00:00Z"), "Europe/Rome") !== 1) throw new Error("localDow Monday");
    });
    await T("telegram endpoints are honest when unconfigured: cron 401 on bad key, 503 without DB; webhook 503; status says configured:false", async () => {
      let r = await fetch(walled.base + "/api/cron/nudge?key=wrong"); if (r.status !== 401) throw new Error("cron bad key " + r.status);
      r = await fetch(walled.base + "/api/cron/nudge?key=k3y"); if (r.status !== 503) throw new Error("cron no DB " + r.status);
      r = await fetch(walled.base + "/api/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); if (r.status !== 503) throw new Error("webhook " + r.status);
      const d = await (await fetch(walled.base + "/api/nudge/status")).json(); if (d.configured !== false || d.signedIn !== false || d.linked !== false) throw new Error(JSON.stringify(d));
      r = await fetch(walled.base + "/api/nudge/link", { method: "POST" }); if (r.status !== 503) throw new Error("link no DB " + r.status);
      r = await fetch(walled.base + "/api/telegram/setup?key=k3y"); if (r.status !== 503) throw new Error("setup no token " + r.status);
    });
    await T("existing behaviour intact: health, stt-status, auth without DB → 503", async () => {
      if (!(await (await fetch(walled.base + "/api/health")).json()).ok) throw new Error("health");
      const s = await (await fetch(walled.base + "/api/stt-status")).json(); if (s.enabled !== false) throw new Error("stt");
      const a = await fetch(walled.base + "/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "farwa", pin: "1234" }) });
      if (a.status !== 503) throw new Error("auth " + a.status);
    });
  } finally {
    dormant.p.kill(); walled.p.kill();
  }
  console.log(results.join("\n"));
  const fails = results.filter((r) => r[0] === "✗").length;
  console.log(fails ? "\n" + fails + " FAILURES" : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
