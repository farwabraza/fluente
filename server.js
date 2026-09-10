// FLUENTE server — serves the app and proxies Claude API calls.
// Your Anthropic API key lives ONLY here (in Replit Secrets), never in the browser.

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const app = express();

// Keep the raw body around: the payment webhook verifies an HMAC over the exact bytes it received.
app.use(express.json({ limit: "1mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, "public")));

// Health check — also used by the client at boot to wake a sleeping free-tier instance early
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Tiny in-memory rate limit so a leaked URL can't drain your credits
// (default 60/min per IP; note users behind the same WiFi share an IP — raise via RATE_LIMIT_PER_MIN)
const RATE_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MIN) || 60;
const hits = new Map();
const daily = new Map(); // per-IP daily AI-call counter (optional cap for shared/sold deployments)
let dailyKey = new Date().toISOString().slice(0, 10);
const ipOf = (req) => req.headers["x-forwarded-for"] || req.ip || "x";
function rateLimit(req, res, next) {
  const ip = ipOf(req);
  const now = Date.now();
  const windowStart = now - 60_000;
  const arr = (hits.get(ip) || []).filter((t) => t > windowStart);
  arr.push(now);
  hits.set(ip, arr);
  if (arr.length > RATE_PER_MIN) {
    return res.status(429).json({ error: { message: "Slow down — too many requests this minute." } });
  }
  next();
}
function dailyCap(req, res, next) {
  const cap = parseInt(process.env.DAILY_AI_LIMIT) || 0; // 0 = off
  if (!cap) return next();
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyKey) { dailyKey = today; daily.clear(); }
  const ip = ipOf(req);
  const n = (daily.get(ip) || 0) + 1;
  daily.set(ip, n);
  if (n > cap) {
    return res.status(429).json({ error: { message: "Daily AI limit reached — come back tomorrow (or upgrade your plan)." } });
  }
  next();
}

// ---------- PRO TIER — DORMANT unless PRO_ENFORCE=1 (see README "Pro paywall") ----------
// With PRO_ENFORCE unset nothing below refuses anything: the client still sends a `feature`
// tag with every AI call (useful for the per-feature cost log), and /api/plan says enforce:false.
const PRO_ENFORCE = /^(1|true|yes|on)$/i.test(String(process.env.PRO_ENFORCE || ""));
const CHECKOUT_URL = process.env.CHECKOUT_URL || ""; // Lemon Squeezy / Paddle checkout link
// Outcome features are Pro; habit features stay free (with a daily allowance so the key is protected).
const PRO_FEATURES = new Set(["esame_scritta", "esame_orale", "esame_ascolto", "esame_lettura", "plateau", "packs", "accent7", "mental", "lesson_ai"]);
const FREE_DAILY = { parla: 20, ripara: 1, scrivi: 1, coach: 1 }; // per account per day (per IP when not signed in)
const freeUse = new Map();
let freeKey = new Date().toISOString().slice(0, 10);
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const tokenCache = new Map(); // token hash → { user, at } — saves a DB round-trip per AI call
const TOKEN_TTL = 60_000;
function isProUser(u) { return !!u && u.plan === "pro" && (!u.plan_until || +u.plan_until > Date.now()); }
// Resolves `Authorization: Bearer <token>` (minted by /api/auth) into req.user, or null when anonymous / no DB.
async function withUser(req, res, next) {
  req.user = null;
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok || !pool) return next();
  const th = sha(tok);
  const c = tokenCache.get(th);
  if (c && Date.now() - c.at < TOKEN_TTL) { req.user = c.user; return next(); }
  try {
    const r = await pool.query("SELECT username, plan, plan_until FROM fluente_users WHERE token_hash=$1", [th]);
    const user = r.rows[0] ? { username: r.rows[0].username, plan: r.rows[0].plan || "free", plan_until: +r.rows[0].plan_until || 0 } : null;
    tokenCache.set(th, { user, at: Date.now() });
    req.user = user;
  } catch (e) { /* DB hiccup → treat as anonymous */ }
  next();
}
// Returns a 402 payload when the wall applies, else null. Only ever non-null with PRO_ENFORCE on.
function proWall(req, feature) {
  if (!PRO_ENFORCE) return null;
  const f = String(feature || "").slice(0, 40);
  if (isProUser(req.user)) return null;
  if (PRO_FEATURES.has(f)) {
    return { error: { code: "pro_required", feature: f, message: "Funzione Pro — sblocca il simulatore d'esame e gli strumenti avanzati con FLUENTE Pro." }, checkoutUrl: CHECKOUT_URL };
  }
  const cap = FREE_DAILY[f];
  if (cap) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== freeKey) { freeKey = today; freeUse.clear(); }
    const id = (req.user ? req.user.username : "ip:" + ipOf(req)) + ":" + f;
    const n = (freeUse.get(id) || 0) + 1;
    freeUse.set(id, n);
    if (n > cap) return { error: { code: "pro_required", feature: f, message: `Limite gratuito di oggi raggiunto (${cap}/giorno) — Pro toglie il limite.` }, checkoutUrl: CHECKOUT_URL };
  }
  return null;
}
// The client asks this at boot: is there a wall at all, and where do I stand?
app.get("/api/plan", withUser, (req, res) => {
  const u = req.user;
  res.json({ enforce: PRO_ENFORCE, signedIn: !!u, plan: isProUser(u) ? "pro" : "free", planUntil: u ? +u.plan_until || 0 : 0, checkoutUrl: CHECKOUT_URL });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.post("/api/chat", rateLimit, dailyCap, withUser, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  const { messages, system, max_tokens, feature } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages array required" } });
  }
  const wall = proWall(req, feature);
  if (wall) return res.status(402).json(wall);
  if (!key) {
    return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY is not set. Add it in Replit → Tools → Secrets." } });
  }
  const mt = Math.min(Math.max(parseInt(max_tokens) || 1000, 1), 4000);
  const payload = JSON.stringify({
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
    max_tokens: mt,
    system: system || "",
    messages,
  });
  // Anthropic returns 429 (rate limit) or 529 (overloaded) under load — with two people
  // generating lessons at once this WILL happen on lower API tiers. Retry with backoff,
  // honoring the retry-after header, instead of failing the user's lesson.
  const MAX_TRIES = 3;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: payload,
      });
      if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < MAX_TRIES) {
        const ra = parseFloat(r.headers.get("retry-after"));
        const wait = !isNaN(ra) ? Math.min(ra * 1000, 15000) : attempt * 1800;
        await sleep(wait);
        continue;
      }
      let data;
      try { data = await r.json(); }
      catch (e) { return res.status(502).json({ error: { message: "Claude API returned an unreadable response (HTTP " + r.status + ") — riprova." } }); }
      if (r.status === 429) data = { error: { message: "The Claude API is rate-limiting this key right now (two people generating at once can hit lower API tiers). Waited and retried " + MAX_TRIES + "× — wait ~30s and try again, or raise your tier at console.anthropic.com." } };
      if (r.status === 529) data = { error: { message: "Claude is momentarily overloaded (their side, not yours). Retried " + MAX_TRIES + "× — try again in a minute." } };
      // Per-feature cost log — the numbers you need to price Pro. One line per call, no content.
      if (r.ok && data && data.usage) {
        console.log(`[ai] ${String(feature || "-").slice(0, 40)} ${req.user ? req.user.username : "anon"} in=${data.usage.input_tokens} out=${data.usage.output_tokens}`);
      }
      return res.status(r.status).json(data);
    } catch (e) {
      if (attempt < MAX_TRIES) { await sleep(attempt * 1200); continue; }
      return res.status(502).json({ error: { message: "Upstream API error: " + e.message } });
    }
  }
});

app.get("/api/stt-status", (req, res) => {
  res.json({ enabled: !!process.env.TRANSCRIBE_API_KEY });
});

// ---------- CLOUD TRANSCRIPTION (bypasses iOS Safari's broken on-device speech recognition) ----------
// The client records raw audio with MediaRecorder (works on iOS 14.3+) and POSTs the blob here.
// We forward it to a Whisper-compatible endpoint — Groq by default (fast + cheap), or OpenAI.
function extFor(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4") || m.includes("m4a")) return "mp4";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "webm";
}
app.post("/api/transcribe", rateLimit, dailyCap, express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
  const key = process.env.TRANSCRIBE_API_KEY;
  if (!key) return res.status(503).json({ error: { message: "Voice transcription isn't set up on this server — add TRANSCRIBE_API_KEY (see README)." } });
  if (!req.body || !req.body.length) return res.status(400).json({ error: { message: "No audio received." } });
  const base = (process.env.TRANSCRIBE_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
  const model = process.env.TRANSCRIBE_MODEL || "whisper-large-v3-turbo";
  const mime = req.headers["x-audio-mime"] || req.headers["content-type"] || "audio/webm";
  try {
    const form = new FormData();
    form.append("file", new Blob([req.body], { type: mime }), "audio." + extFor(mime));
    form.append("model", model);
    form.append("language", "it"); // FLUENTE is Italian-only — pin it, avoids Whisper language misdetection on short clips
    const r = await fetch(base + "/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      body: form,
    });
    let data;
    try { data = await r.json(); }
    catch (e) { return res.status(502).json({ error: { message: "Transcription service returned an unexpected response (HTTP " + r.status + ") — check TRANSCRIBE_BASE_URL / TRANSCRIBE_API_KEY." } }); }
    if (!r.ok) return res.status(r.status).json({ error: { message: (data.error && data.error.message) || "Transcription failed." } });
    res.json({ text: (data.text || "").trim() });
  } catch (e) {
    res.status(502).json({ error: { message: "Transcription upstream error: " + e.message } });
  }
});

// ---------- ACCOUNTS & CLOUD SYNC (needs DATABASE_URL — see README) ----------
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`CREATE TABLE IF NOT EXISTS fluente_users(
    username TEXT PRIMARY KEY,
    pinhash  TEXT NOT NULL,
    state    JSONB,
    updated_at BIGINT DEFAULT 0)`)
    // Pro-tier columns. Server-owned: the client never writes these (state JSONB is client-owned).
    .then(() => pool.query(`ALTER TABLE fluente_users
      ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS plan_until BIGINT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS token_hash TEXT,
      ADD COLUMN IF NOT EXISTS mor_customer_id TEXT`))
    .then(() => console.log("DB ready — cloud sync ON" + (PRO_ENFORCE ? " · Pro wall ON" : " · Pro wall dormant")))
    .catch((e) => console.error("DB init failed:", e.message));
} else {
  console.log("No DATABASE_URL — running in device-only mode (no cloud sync).");
}
const hashPin = (u, p) => crypto.scryptSync(String(p), "fluente:" + u.toLowerCase(), 32).toString("hex");
const saneUser = (s) => typeof s === "string" && /^[a-z0-9_.-]{3,24}$/i.test(s);
// A fresh bearer token per sign-in; only its hash is stored. The token identifies the account on AI calls.
async function mintToken(u) {
  const token = crypto.randomBytes(24).toString("hex");
  await pool.query("UPDATE fluente_users SET token_hash=$2 WHERE username=$1", [u, sha(token)]);
  return token;
}

// Sign in OR create account (first login with a new name creates it)
app.post("/api/auth", rateLimit, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "Sync not configured on the server." } });
  const { username, pin } = req.body || {};
  if (!saneUser(username) || !pin || String(pin).length < 4)
    return res.status(400).json({ error: { message: "Username: 3–24 letters/numbers. PIN: at least 4 characters." } });
  const u = username.toLowerCase(), h = hashPin(u, pin);
  try {
    const r = await pool.query("SELECT pinhash, state, updated_at, plan, plan_until FROM fluente_users WHERE username=$1", [u]);
    if (!r.rows.length) {
      await pool.query("INSERT INTO fluente_users(username,pinhash) VALUES($1,$2)", [u, h]);
      const token = await mintToken(u);
      return res.json({ ok: true, created: true, state: null, updatedAt: 0, token, plan: "free", planUntil: 0 });
    }
    if (r.rows[0].pinhash !== h) return res.status(401).json({ error: { message: "Wrong PIN for this username." } });
    const token = await mintToken(u);
    const row = { plan: r.rows[0].plan || "free", plan_until: +r.rows[0].plan_until || 0 };
    res.json({ ok: true, created: false, state: r.rows[0].state, updatedAt: +r.rows[0].updated_at || 0, token, plan: isProUser(row) ? "pro" : "free", planUntil: row.plan_until });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

// Save state to the cloud
app.put("/api/state", rateLimit, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "Sync not configured." } });
  const { username, pin, state, updatedAt } = req.body || {};
  if (!saneUser(username)) return res.status(400).json({ error: { message: "Bad username." } });
  const u = username.toLowerCase(), h = hashPin(u, pin || "");
  try {
    const r = await pool.query("SELECT pinhash FROM fluente_users WHERE username=$1", [u]);
    if (!r.rows.length || r.rows[0].pinhash !== h) return res.status(401).json({ error: { message: "Auth failed." } });
    await pool.query("UPDATE fluente_users SET state=$2, updated_at=$3 WHERE username=$1", [u, state, updatedAt || Date.now()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

// ---------- PAYMENT WEBHOOK (merchant of record → plan column) ----------
// Lemon Squeezy format: header X-Signature = HMAC-SHA256(raw body, MOR_WEBHOOK_SECRET) as hex.
// Point the webhook at https://<your-app>/api/webhook/mor and subscribe it to the subscription_* events.
// The checkout link should carry the username as custom data (checkout[custom][username]) so the
// order maps to an account; e-mail is the fallback match.
const MOR_ACTIVATE = new Set(["subscription_created", "subscription_updated", "subscription_resumed", "subscription_payment_success", "subscription_unpaused"]);
const MOR_END = new Set(["subscription_cancelled", "subscription_expired", "subscription_paused", "subscription_payment_failed"]);
app.post("/api/webhook/mor", async (req, res) => {
  const secret = process.env.MOR_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: { message: "MOR_WEBHOOK_SECRET not set." } });
  const sig = String(req.headers["x-signature"] || "");
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody || Buffer.alloc(0)).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).json({ error: { message: "Bad signature." } });
  }
  if (!pool) return res.status(503).json({ error: { message: "Sync not configured — no DB to store plans in." } });
  const ev = req.body || {};
  const name = ev.meta && ev.meta.event_name;
  const attrs = (ev.data && ev.data.attributes) || {};
  const custom = (ev.meta && ev.meta.custom_data) || {};
  const email = attrs.user_email ? String(attrs.user_email).toLowerCase() : null;
  const customer = attrs.customer_id != null ? String(attrs.customer_id) : null;
  let plan, until;
  if (MOR_ACTIVATE.has(name)) {
    plan = "pro";
    until = Date.parse(attrs.renews_at || attrs.ends_at || "") || 0; // 0 = no expiry known → stays pro until an END event
    if (attrs.status && /expired|cancelled|unpaid/.test(String(attrs.status)) && !attrs.ends_at) until = 0;
  } else if (MOR_END.has(name)) {
    plan = "pro"; // access continues until the paid period ends
    until = Date.parse(attrs.ends_at || attrs.renews_at || "") || Date.now();
  } else {
    return res.json({ ok: true, ignored: name || "unknown" });
  }
  let where, val;
  if (saneUser(custom.username)) { where = "username=$1"; val = String(custom.username).toLowerCase(); }
  else if (email) { where = "LOWER(email)=$1"; val = email; }
  else return res.status(202).json({ ok: false, unmatched: true, reason: "no username or e-mail in event" });
  try {
    const r = await pool.query(
      `UPDATE fluente_users SET plan=$2, plan_until=$3, mor_customer_id=COALESCE($4, mor_customer_id), email=COALESCE(email, $5) WHERE ${where} RETURNING username`,
      [val, plan, until, customer, email]);
    if (!r.rowCount) return res.status(202).json({ ok: false, unmatched: true, reason: "no account for " + val });
    tokenCache.clear(); // plan changed — don't serve a stale cached plan for up to a minute
    console.log(`[mor] ${name} → ${r.rows[0].username} plan=${plan} until=${until || "∞"}`);
    res.json({ ok: true, username: r.rows[0].username, plan, planUntil: until });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("FLUENTE in partenza → http://localhost:" + PORT + (PRO_ENFORCE ? " · Pro wall ON" : "")));
