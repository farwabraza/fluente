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

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("FLUENTE in partenza → http://localhost:" + PORT));
