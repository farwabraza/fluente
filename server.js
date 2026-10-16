// FLUENTE server — serves the app and proxies Claude API calls.
// Your Anthropic API key lives ONLY here (in Replit Secrets), never in the browser.

const express = require("express");
const path = require("path");
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Health check — also used by the client at boot to wake a sleeping free-tier instance early
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Tiny in-memory rate limit so a leaked URL can't drain your credits.
// Keyed per ACCOUNT when the client sends its username (so two people on the
// same WiFi don't share a budget), per IP otherwise.
const RATE_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MIN) || 60;
const hits = new Map();
const daily = new Map(); // per-account/IP daily AI-call counter (optional cap for shared/sold deployments)
let dailyKey = new Date().toISOString().slice(0, 10);
function rateKey(req) {
  const b = req.body || {};
  const u = (typeof b.u === "string" && b.u.trim()) || (typeof b.username === "string" && b.username.trim());
  if (u) return "u:" + u.slice(0, 40).toLowerCase();
  return "ip:" + (req.headers["x-forwarded-for"] || req.ip || "x");
}
function rateLimit(req, res, next) {
  const key = rateKey(req);
  const now = Date.now();
  const windowStart = now - 60_000;
  const arr = (hits.get(key) || []).filter((t) => t > windowStart);
  arr.push(now);
  hits.set(key, arr);
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
  const key = rateKey(req);
  const n = (daily.get(key) || 0) + 1;
  daily.set(key, n);
  if (n > cap) {
    return res.status(429).json({ error: { message: "Daily AI limit reached — come back tomorrow (or upgrade your plan)." } });
  }
  next();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.post("/api/chat", rateLimit, dailyCap, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY is not set. Add it in Replit → Tools → Secrets." } });
  }
  const { messages, system, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages array required" } });
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
const crypto = require("crypto");
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS fluente_users(
      username TEXT PRIMARY KEY,
      pinhash  TEXT NOT NULL,
      state    JSONB,
      updated_at BIGINT DEFAULT 0)`);
    // v7.1 — who-is-using-this visibility + invite gating (idempotent migrations)
    await pool.query(`ALTER TABLE fluente_users ADD COLUMN IF NOT EXISTS created_at BIGINT DEFAULT 0`);
    await pool.query(`ALTER TABLE fluente_users ADD COLUMN IF NOT EXISTS last_seen BIGINT DEFAULT 0`);
    await pool.query(`ALTER TABLE fluente_users ADD COLUMN IF NOT EXISTS invite_code TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS fluente_invites(
      code TEXT PRIMARY KEY,
      note TEXT,
      created_at BIGINT,
      used_by TEXT,
      used_at BIGINT)`);
    console.log("DB ready — cloud sync ON");
  })().catch((e) => console.error("DB init failed:", e.message));
} else {
  console.log("No DATABASE_URL — running in device-only mode (no cloud sync).");
}
const hashPin = (u, p) => crypto.scryptSync(String(p), "fluente:" + u.toLowerCase(), 32).toString("hex");
const saneUser = (s) => typeof s === "string" && /^[a-z0-9_.-]{3,24}$/i.test(s);

// Sign in. Creating a NEW account requires a valid, unused invite code
// (generated in the admin panel, sent to the person by email by the admin).
// Accounts that already exist sign in with username + PIN as before.
app.post("/api/auth", rateLimit, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "Sync not configured on the server." } });
  const { username, pin, invite } = req.body || {};
  if (!saneUser(username) || !pin || String(pin).length < 4)
    return res.status(400).json({ error: { message: "Username: 3–24 letters/numbers. PIN: at least 4 characters." } });
  const u = username.toLowerCase(), h = hashPin(u, pin);
  try {
    const r = await pool.query("SELECT pinhash, state, updated_at FROM fluente_users WHERE username=$1", [u]);
    if (!r.rows.length) {
      const code = String(invite || "").trim().toUpperCase();
      if (!code) return res.status(403).json({ needInvite: true, error: { message: "New accounts need an invite code — check the email from your admin, or ask for one." } });
      // consume atomically: only succeeds if the code exists and is unused
      const inv = await pool.query("UPDATE fluente_invites SET used_by=$2, used_at=$3 WHERE code=$1 AND used_by IS NULL RETURNING code", [code, u, Date.now()]);
      if (!inv.rows.length) return res.status(403).json({ needInvite: true, error: { message: "That invite code is invalid or already used — each code works exactly once." } });
      await pool.query("INSERT INTO fluente_users(username,pinhash,created_at,last_seen,invite_code) VALUES($1,$2,$3,$3,$4)", [u, h, Date.now(), code]);
      return res.json({ ok: true, created: true, state: null, updatedAt: 0 });
    }
    if (r.rows[0].pinhash !== h) return res.status(401).json({ error: { message: "Wrong PIN for this username." } });
    pool.query("UPDATE fluente_users SET last_seen=$2 WHERE username=$1", [u, Date.now()]).catch(() => {});
    res.json({ ok: true, created: false, state: r.rows[0].state, updatedAt: +r.rows[0].updated_at || 0 });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

// Save state to the cloud (also refreshes last_seen — this is the heartbeat)
app.put("/api/state", rateLimit, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "Sync not configured." } });
  const { username, pin, state, updatedAt } = req.body || {};
  if (!saneUser(username)) return res.status(400).json({ error: { message: "Bad username." } });
  const u = username.toLowerCase(), h = hashPin(u, pin || "");
  try {
    const r = await pool.query("SELECT pinhash FROM fluente_users WHERE username=$1", [u]);
    if (!r.rows.length || r.rows[0].pinhash !== h) return res.status(401).json({ error: { message: "Auth failed." } });
    await pool.query("UPDATE fluente_users SET state=$2, updated_at=$3, last_seen=$4 WHERE username=$1", [u, state, updatedAt || Date.now(), Date.now()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

// ---------- ADMIN (needs ADMIN_KEY env secret; UI at /admin.html) ----------
function adminAuth(req, res, next) {
  const k = process.env.ADMIN_KEY;
  if (!k) return res.status(503).json({ error: { message: "ADMIN_KEY is not set on the server — add it as a secret (any long random string) to enable the admin panel." } });
  if ((req.headers["x-admin-key"] || "") !== k) return res.status(401).json({ error: { message: "Wrong admin key." } });
  next();
}
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — codes get read out loud
function makeInviteCode() {
  const pick = (n) => Array.from({ length: n }, () => INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)]).join("");
  return "FLU-" + pick(4) + "-" + pick(4);
}

// Everything the admin needs on one call: users (who + when), invites, today's AI usage
app.get("/api/admin/overview", rateLimit, adminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "No DATABASE_URL — accounts are off, so there are no users to list." } });
  try {
    const users = await pool.query("SELECT username, created_at, last_seen, invite_code FROM fluente_users ORDER BY last_seen DESC");
    const invites = await pool.query("SELECT code, note, created_at, used_by, used_at FROM fluente_invites ORDER BY created_at DESC");
    const today = new Date().toISOString().slice(0, 10);
    // in-memory counters: today's AI calls per account/IP (approximate — resets if the server restarts)
    const aiToday = dailyKey === today ? [...daily.entries()].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n) : [];
    res.json({ ok: true, users: users.rows, invites: invites.rows, aiToday, rateLimitPerMin: RATE_PER_MIN, dailyCap: parseInt(process.env.DAILY_AI_LIMIT) || 0 });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

app.post("/api/admin/invite", rateLimit, adminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "No DATABASE_URL — invites need the database." } });
  const note = String((req.body || {}).note || "").slice(0, 120);
  try {
    const code = makeInviteCode();
    await pool.query("INSERT INTO fluente_invites(code,note,created_at) VALUES($1,$2,$3)", [code, note, Date.now()]);
    res.json({ ok: true, code });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

app.delete("/api/admin/invite/:code", rateLimit, adminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "No DATABASE_URL." } });
  try {
    const r = await pool.query("DELETE FROM fluente_invites WHERE code=$1 AND used_by IS NULL", [String(req.params.code || "").toUpperCase()]);
    res.json({ ok: true, deleted: r.rowCount > 0 }); // used codes are history — they can't be deleted
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

// Forgotten-PIN rescue: set a new PIN for an existing account WITHOUT touching
// its progress. The user then signs in with the same username + the new PIN.
app.post("/api/admin/reset-pin", rateLimit, adminAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "No DATABASE_URL." } });
  const { username, pin } = req.body || {};
  if (!saneUser(username) || !pin || String(pin).length < 4)
    return res.status(400).json({ error: { message: "Username + a new PIN of at least 4 characters required." } });
  const u = username.toLowerCase();
  try {
    const r = await pool.query("UPDATE fluente_users SET pinhash=$2 WHERE username=$1", [u, hashPin(u, pin)]);
    if (!r.rowCount) return res.status(404).json({ error: { message: "No account with that username." } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log("FLUENTE in partenza → http://localhost:" + PORT));
}
module.exports = { app, _test: { setPool: (p) => { pool = p; } } };
