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
      ADD COLUMN IF NOT EXISTS mor_customer_id TEXT,
      ADD COLUMN IF NOT EXISTS tg_chat_id TEXT,
      ADD COLUMN IF NOT EXISTS tg_code TEXT,
      ADD COLUMN IF NOT EXISTS tg_meta JSONB DEFAULT '{}'::jsonb`))
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

// ---------- ACCOUNTABILITY: TELEGRAM NUDGES (needs TELEGRAM_BOT_TOKEN + CRON_KEY — see README) ----------
// The app never reaches out on its own — this does. An external scheduler (cron-job.org, GitHub Actions…)
// hits GET /api/cron/nudge?key=CRON_KEY once an hour; for every linked account we read prefs + xpLog straight
// out of the synced state (no new tables) and send, in the learner's own timezone:
//   · at the pact hour, if nothing was done yet today   → "slot" message (+ the Monday report card)
//   · at 21:00, if still nothing                        → "evening" message
// Tone follows the learner's own setting: Modalità Brutale on → the bot roasts the skip (never the person).
// The hourly ping also keeps a free-tier server awake.
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_BOT = (process.env.TELEGRAM_BOT_NAME || "").replace(/^@/, "");
const TG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const CRON_KEY = process.env.CRON_KEY || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const appUrl = (req) => APP_URL || ((req.headers["x-forwarded-proto"] || "https") + "://" + req.headers.host);

// Message bank. {name} {slot} {anchor} {streak} {due} {gap} {days} {link} {xp} {best} are filled in.
const NUDGE = {
  gentile: {
    slot: [
      "Sono le {slot}{anchor}. Due minuti: una carta, due scelte, una frase. {link}",
      "{name}, la fermata di oggi ti aspetta. Streak {streak} 🔥 · {due} carte in attesa. {link}",
      "Il patto era {slot}{anchor}. Non serve una sessione eroica — serve la sessione minima. {link}",
      "Oggi la lacuna da riparare è: {gap}. Cinque frasi e il contatore scende. {link}",
    ],
    evening: [
      "Oggi ancora niente. La sessione minima sono 2 minuti — la streak di {streak} giorni vale più di così. {link}",
      "Sono le 21. Una carta, due scelte, una frase, e la giornata è salva. {link}",
      "Non serve recuperare: serve non saltare due volte. Due minuti. {link}",
    ],
    weekly: "📋 Pagella della settimana\n· XP: {xp}\n· Giorni attivi: {days}/7\n· Streak: {streak} (record {best})\n· Lacuna n.1: {gap}\n{daysToExam}Nuova settimana, stesso patto: {slot}{anchor}. {link}",
    welcome: "Collegato ✓ Ti scrivo alle {slot}{anchor}, e alle 21 se non ti sei fatta viva. Scrivi /oggi per lo stato, /stop per zittirmi.",
    ack: "Segnato ✓ Brava.",
    status: "🔥 Streak {streak} · {due} carte in attesa · oggi: {done}\n{link}",
    bye: "Promemoria spento. Quando vuoi, ricollegami dall'app.",
  },
  brutale: {
    slot: [
      "Oh, {name}. Sono le {slot}. Il caffè l'hai preso, l'italiano no. Due minuti, cazzo. {link}",
      "Sveglia. {due} carte ti guardano male da stamattina. Anche il mio gatto ha più costanza — e non ho un gatto. {link}",
      "Alle {slot} dovevi aprire Fluente, non Instagram. Sessione minima, ORA, poi torni a fare la sciura. {link}",
      "La tua lacuna preferita, {gap}, ringrazia per la giornata libera. Vai a rovinargliela. {link}",
    ],
    evening: [
      "Sono le 21 e oggi zero. ZERO. La streak di {streak} giorni sta morendo di pigrizia, non di mancanza di tempo. Due minuti. {link}",
      "Ma dai. Domani il paziente non aspetta che tu ripassi le preposizioni. Sessione minima, che cavolo. {link}",
      "Se salti anche stasera la streak la seppelliamo insieme. Fiori no, grazie. {link}",
    ],
    weekly: "📋 Pagella, e non fare quella faccia\n· XP: {xp}\n· Giorni attivi: {days}/7 {verdict}\n· Streak: {streak} (record {best})\n· Lacuna n.1: {gap} — ancora lei, che sorpresa\n{daysToExam}Nuova settimana. Alle {slot}{anchor}. Niente storie. {link}",
    welcome: "Collegato. Ora non hai più scuse. Alle {slot}{anchor} ti rompo le scatole; alle 21 di nuovo se fai la furba. /oggi per lo stato, /stop se sei codarda.",
    ack: "Miracolo. Segna la data. ✓",
    status: "🔥 Streak {streak} · {due} carte che ti aspettano · oggi: {done}\n{link}",
    bye: "Spento. Vediamo quanto duri da sola. (Poco.)",
  },
};
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
function fill(tpl, v) { return tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? "" : String(v[k]))); }
// Everything the messages need, derived from the synced state (client-owned) — never stored server-side.
function nudgeVars(row, req, dayKey) {
  const st = row.state || {}, prefs = st.prefs || {}, goal = st.goal || {};
  const xpLog = st.xpLog || {};
  const week = []; for (let i = 0; i < 7; i++) { const d = new Date(Date.now() - i * 86400e3); week.push(localDay(d, prefs.tz)); }
  const xp = week.reduce((s, k) => s + (xpLog[k] || 0), 0), days = week.filter((k) => xpLog[k]).length;
  const gaps = Object.entries(st.errLog || {}).filter(([, e]) => e && e.n > 0).sort((a, b) => b[1].n - a[1].n);
  const gapNames = { tempo_passati: "passato prossimo vs imperfetto", congiuntivo_quando: "quando scatta il congiuntivo", congiuntivo_forma: "le forme del congiuntivo", condizionale: "condizionale e ipotetiche", futuro: "il futuro", ausiliare: "essere vs avere", coniugazione: "le coniugazioni", concordanza: "la concordanza", preposizioni: "le preposizioni", articoli: "gli articoli", pronomi: "i pronomi", ordine_parole: "l'ordine delle parole", vocab: "la scelta delle parole", ortografia: "ortografia e accenti", registro: "il registro" };
  const due = Array.isArray(st.deck) ? st.deck.filter((c) => c && c.due <= Date.now()).length : 0;
  let daysToExam = "";
  if (goal.examDate) { const n = Math.ceil((Date.parse(goal.examDate) - Date.parse(dayKey)) / 86400e3); if (n >= 0) daysToExam = `· ${n} giorni all'esame ${goal.target || ""}\n`; }
  return {
    name: st.name || row.username, slot: prefs.slot || "08:15", anchor: prefs.anchor ? " " + prefs.anchor : "",
    streak: st.streak || 0, best: st.streakBest || st.streak || 0, due, gap: gaps[0] ? gapNames[gaps[0][0]] || gaps[0][0] : "nessuna mappata (parla e vediamo)",
    xp, days, verdict: days >= 6 ? "— rispetto." : days >= 4 ? "— così così." : "— ma dai.", daysToExam,
    done: xpLog[dayKey] ? "fatto ✓" : "niente, per ora",
    link: appUrl(req) + "/?go=micro",
  };
}
function localDay(d, tz) { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); } catch (e) { return d.toISOString().slice(0, 10); } }
function localHour(d, tz) { try { return +new Intl.DateTimeFormat("en-GB", { timeZone: tz || "Europe/Rome", hour: "2-digit", hour12: false }).format(d).slice(0, 2) % 24; } catch (e) { return d.getUTCHours(); } }
function localDow(d, tz) { try { return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[new Intl.DateTimeFormat("en-US", { timeZone: tz || "Europe/Rome", weekday: "short" }).format(d)] || 1; } catch (e) { return ((d.getUTCDay() + 6) % 7) + 1; } }
function composeNudge(kind, row, req, dayKey) {
  const v = nudgeVars(row, req, dayKey || localDay(new Date(), (row.state && row.state.prefs && row.state.prefs.tz) || undefined));
  const bank = NUDGE[row.state && row.state.brutale ? "brutale" : "gentile"];
  const seed = (dayKey || "").split("-").reduce((s, x) => s + (+x || 0), 0) + row.username.length;
  const t = Array.isArray(bank[kind]) ? pick(bank[kind], seed) : bank[kind];
  return fill(t, v);
}
async function tgSend(chatId, text) {
  if (!TG_TOKEN) return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" };
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) });
  return r.json().catch(() => ({ ok: false }));
}
const needUser = (req, res) => { if (!pool) { res.status(503).json({ error: { message: "Sync not configured on the server." } }); return false; } if (!req.user) { res.status(401).json({ error: { message: "Accedi per usare i promemoria." } }); return false; } return true; };
const tgConfigured = () => !!(TG_TOKEN && TG_BOT);

app.get("/api/nudge/status", withUser, async (req, res) => {
  const out = { configured: tgConfigured(), bot: TG_BOT, linked: false, signedIn: !!req.user };
  if (pool && req.user) {
    try { const r = await pool.query("SELECT tg_chat_id FROM fluente_users WHERE username=$1", [req.user.username]); out.linked = !!(r.rows[0] && r.rows[0].tg_chat_id); } catch (e) {}
  }
  res.json(out);
});
app.post("/api/nudge/link", rateLimit, withUser, async (req, res) => {
  if (!needUser(req, res)) return;
  if (!tgConfigured()) return res.status(503).json({ error: { message: "Telegram non è configurato su questo server — aggiungi TELEGRAM_BOT_TOKEN e TELEGRAM_BOT_NAME (README)." } });
  const code = String(crypto.randomInt(100000, 999999));
  try {
    await pool.query("UPDATE fluente_users SET tg_code=$2 WHERE username=$1", [req.user.username, code]);
    res.json({ ok: true, code, bot: TG_BOT, url: `https://t.me/${TG_BOT}?start=${code}` });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});
app.post("/api/nudge/unlink", rateLimit, withUser, async (req, res) => {
  if (!needUser(req, res)) return;
  try {
    const r = await pool.query("UPDATE fluente_users SET tg_chat_id=NULL, tg_code=NULL WHERE username=$1 RETURNING tg_chat_id", [req.user.username]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});
// Sends the real slot message right now — so the learner hears the voice they chose before trusting it.
app.post("/api/nudge/test", rateLimit, withUser, async (req, res) => {
  if (!needUser(req, res)) return;
  try {
    const r = await pool.query("SELECT username, tg_chat_id, state FROM fluente_users WHERE username=$1", [req.user.username]);
    const row = r.rows[0];
    if (!row || !row.tg_chat_id) return res.status(400).json({ error: { message: "Telegram non ancora collegato." } });
    const tz = row.state && row.state.prefs && row.state.prefs.tz;
    const out = await tgSend(row.tg_chat_id, composeNudge("slot", row, req, localDay(new Date(), tz)));
    res.json({ ok: !!out.ok, telegram: out.description || undefined });
  } catch (e) { res.status(500).json({ error: { message: "DB error: " + e.message } }); }
});
// Telegram → us. Set with GET /api/telegram/setup?key=CRON_KEY (or manually via setWebhook).
app.post("/api/telegram", async (req, res) => {
  if (!TG_TOKEN) return res.status(503).json({ ok: false });
  if (TG_SECRET && req.headers["x-telegram-bot-api-secret-token"] !== TG_SECRET) return res.status(401).json({ ok: false });
  res.json({ ok: true }); // answer Telegram immediately; do the work after
  if (!pool) return;
  const msg = (req.body && (req.body.message || req.body.edited_message)) || null;
  if (!msg || !msg.chat || typeof msg.text !== "string") return;
  const chatId = String(msg.chat.id), text = msg.text.trim();
  try {
    const m = text.match(/^\/start\s+(\d{6})$/);
    if (m) {
      const r = await pool.query("UPDATE fluente_users SET tg_chat_id=$2, tg_code=NULL, tg_meta=COALESCE(tg_meta,'{}'::jsonb)||$3::jsonb WHERE tg_code=$1 RETURNING username, state", [m[1], chatId, JSON.stringify({ linkedAt: Date.now() })]);
      if (!r.rowCount) return void tgSend(chatId, "Codice non valido o scaduto — genera un nuovo codice dall'app (Oggi → Promemoria).");
      return void tgSend(chatId, composeNudge("welcome", r.rows[0], req, localDay(new Date())));
    }
    const r = await pool.query("SELECT username, state FROM fluente_users WHERE tg_chat_id=$1", [chatId]);
    const row = r.rows[0];
    if (!row) return void tgSend(chatId, "Non ti conosco ancora. Apri Fluente → Oggi → Promemoria → Collega Telegram.");
    const tz = row.state && row.state.prefs && row.state.prefs.tz;
    if (/^\/stop\b/i.test(text)) { await pool.query("UPDATE fluente_users SET tg_chat_id=NULL WHERE username=$1", [row.username]); return void tgSend(chatId, composeNudge("bye", row, req, localDay(new Date(), tz))); }
    if (/^fatto\b/i.test(text)) return void tgSend(chatId, composeNudge("ack", row, req, localDay(new Date(), tz)));
    return void tgSend(chatId, composeNudge("status", row, req, localDay(new Date(), tz)));
  } catch (e) { console.error("[tg]", e.message); }
});
app.get("/api/telegram/setup", async (req, res) => {
  if (!CRON_KEY || req.query.key !== CRON_KEY) return res.status(401).json({ error: { message: "Bad key." } });
  if (!TG_TOKEN) return res.status(503).json({ error: { message: "TELEGRAM_BOT_TOKEN not set." } });
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: appUrl(req) + "/api/telegram", secret_token: TG_SECRET || undefined, allowed_updates: ["message"] }) });
    res.json(await r.json());
  } catch (e) { res.status(502).json({ error: { message: e.message } }); }
});
// The hourly heartbeat. Idempotent per (user, day, kind) via tg_meta.last.
app.get("/api/cron/nudge", async (req, res) => {
  if (!CRON_KEY || req.query.key !== CRON_KEY) return res.status(401).json({ error: { message: "Bad key." } });
  if (!pool) return res.status(503).json({ error: { message: "Sync not configured — nothing to nudge." } });
  if (!TG_TOKEN) return res.json({ ok: true, checked: 0, sent: [], note: "TELEGRAM_BOT_TOKEN not set" });
  const now = new Date(), sent = [], dry = req.query.dry === "1";
  try {
    const r = await pool.query("SELECT username, tg_chat_id, tg_meta, state FROM fluente_users WHERE tg_chat_id IS NOT NULL");
    for (const row of r.rows) {
      const st = row.state || {}, prefs = st.prefs || {};
      if (prefs.nudge === "none") continue;
      const tz = prefs.tz || "Europe/Rome", day = localDay(now, tz), hour = localHour(now, tz), dow = localDow(now, tz);
      if (Array.isArray(prefs.days) && prefs.days.length && !prefs.days.includes(dow)) continue;
      const slotHour = parseInt((prefs.slot || "08:15").slice(0, 2)) || 8;
      const doneToday = !!((st.xpLog || {})[day]);
      const last = (row.tg_meta && row.tg_meta.last) || {};
      let kind = null;
      if (hour === slotHour && !doneToday && !(last.day === day && (last.kind === "slot" || last.kind === "weekly"))) kind = dow === 1 ? "weekly" : "slot";
      else if (hour === 21 && slotHour < 21 && !doneToday && !(last.day === day && last.kind === "evening")) kind = "evening";
      if (!kind) continue;
      const text = composeNudge(kind, row, req, day);
      if (!dry) {
        const out = await tgSend(row.tg_chat_id, text);
        if (out && out.ok) await pool.query("UPDATE fluente_users SET tg_meta=COALESCE(tg_meta,'{}'::jsonb)||$2::jsonb WHERE username=$1", [row.username, JSON.stringify({ last: { day, kind } })]);
        else if (out && /blocked|chat not found|deactivated/i.test(out.description || "")) await pool.query("UPDATE fluente_users SET tg_chat_id=NULL WHERE username=$1", [row.username]);
      }
      sent.push({ username: row.username, kind, preview: dry ? text : undefined });
    }
    res.json({ ok: true, checked: r.rowCount, sent });
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
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log("FLUENTE in partenza → http://localhost:" + PORT + (PRO_ENFORCE ? " · Pro wall ON" : "") + (TG_TOKEN ? " · Telegram ON" : "")));
}
module.exports = { app, composeNudge, NUDGE, localDay, localHour, localDow };
