// FLUENTE server — serves the app and proxies Claude API calls.
// Your Anthropic API key lives ONLY here (in Replit Secrets), never in the browser.

const express = require("express");
const path = require("path");
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Tiny in-memory rate limit so a leaked URL can't drain your credits
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.ip || "x";
  const now = Date.now();
  const windowStart = now - 60_000;
  const arr = (hits.get(ip) || []).filter((t) => t > windowStart);
  arr.push(now);
  hits.set(ip, arr);
  if (arr.length > 30) {
    return res.status(429).json({ error: { message: "Slow down — too many requests this minute." } });
  }
  next();
}

app.post("/api/chat", rateLimit, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY is not set. Add it in Replit → Tools → Secrets." } });
  }
  const { messages, system } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages array required" } });
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
        max_tokens: 1000,
        system: system || "",
        messages,
      }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: { message: "Upstream API error: " + e.message } });
  }
});

// ---------- ACCOUNTS & CLOUD SYNC (needs DATABASE_URL — see README) ----------
const crypto = require("crypto");
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`CREATE TABLE IF NOT EXISTS fluente_users(
    username TEXT PRIMARY KEY,
    pinhash  TEXT NOT NULL,
    state    JSONB,
    updated_at BIGINT DEFAULT 0)`).then(() => console.log("DB ready — cloud sync ON"))
    .catch((e) => console.error("DB init failed:", e.message));
} else {
  console.log("No DATABASE_URL — running in device-only mode (no cloud sync).");
}
const hashPin = (u, p) => crypto.scryptSync(String(p), "fluente:" + u.toLowerCase(), 32).toString("hex");
const saneUser = (s) => typeof s === "string" && /^[a-z0-9_.-]{3,24}$/i.test(s);

// Sign in OR create account (first login with a new name creates it)
app.post("/api/auth", rateLimit, async (req, res) => {
  if (!pool) return res.status(503).json({ error: { message: "Sync not configured on the server." } });
  const { username, pin } = req.body || {};
  if (!saneUser(username) || !pin || String(pin).length < 4)
    return res.status(400).json({ error: { message: "Username: 3–24 letters/numbers. PIN: at least 4 characters." } });
  const u = username.toLowerCase(), h = hashPin(u, pin);
  try {
    const r = await pool.query("SELECT pinhash, state, updated_at FROM fluente_users WHERE username=$1", [u]);
    if (!r.rows.length) {
      await pool.query("INSERT INTO fluente_users(username,pinhash) VALUES($1,$2)", [u, h]);
      return res.json({ ok: true, created: true, state: null, updatedAt: 0 });
    }
    if (r.rows[0].pinhash !== h) return res.status(401).json({ error: { message: "Wrong PIN for this username." } });
    res.json({ ok: true, created: false, state: r.rows[0].state, updatedAt: +r.rows[0].updated_at || 0 });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("FLUENTE in partenza → http://localhost:" + PORT));
