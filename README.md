# FLUENTE 🚇 — Italian, all the way to native

ADHD-first Italian fluency app. AI micro-lessons, a speech-recognition speaking booth,
a **gap-detection engine** that maps your personal weaknesses from every mistake you make,
a **CILS/CELI exam simulator** graded on the real rubric, medical & bureaucratic Italian,
dictation, verb sprints, tense-choice drills, frequency-ranked vocabulary, and an SRS
with mnemonics, leech rescue, and production-direction recall.

---

## What's new in v6 — "Milano Editoriale" (the redesign)

A full visual rebuild in Italian editorial modernism — Milan's design heritage (the city that gave the world Vignelli's transit graphics, which this app's metro map already lives in):

- **Typography:** Fraunces (editorial display serif, italic logo) + Hanken Grotesk (UI) + Spline Sans Mono (metro-signage eyebrows).
- **Paper & light:** warm paper background with a subtle print-grain overlay; hairline borders and layered soft shadows replace the old hard brutalist offsets.
- **Auto light + dark:** follows your system by default; the ◐ button in the header cycles auto → day → *Notte a Milano* (warm espresso-plum dark, not dead blue-black). Preference persists, applied before first paint (no flash).
- **Floating glass dock:** the nav is now a detached, blurred, rounded dock with a springy active indicator — safe-area aware on iPhone.
- **Satisfaction layer:** spring physics on every press, staggered list reveals, shimmer on progress bars, 3D spring card flips, shake/pop on wrong/right answers, haptic buzz + quattro-linee confetti on checkpoint passes, exam passes, and near-perfect Scelta rounds. All of it respects `prefers-reduced-motion`.
- Every JS-generated inline style swept onto the theme token system — both themes verified variable-by-variable (36 automated checks).
- Login + cloud sync retained untouched; login screen inherits the new skin automatically.

---

## What's new in v5 — the iOS mic fix

**The problem:** iOS Safari's built-in speech recognition (`webkitSpeechRecognition`) is unreliable-to-absent in PWAs — that's an iOS/Safari limitation, not something fixable client-side. Since this app is speaking-heavy (booth, checkpoints, exam orale, pronuncia drills), that was a real gap on iPhone.

**The fix:** iOS *can* record raw audio fine (`MediaRecorder`, supported since iOS 14.3) — it's only on-device transcription that's broken. So on iPhone the app now: records audio in-browser with silence-detection auto-stop (same feel as native speech recognition), uploads the clip to your server, and transcribes it there with a real Whisper-class model. Android/desktop are untouched — they keep using the free, instant, on-device browser API. Every mic button in the app (booth, checkpoints, lesson speaking, exam orale, pronuncia intelligibility test) uses this transparently — same buttons, same flow, no extra taps.

**Setup (one more secret, same pattern as before):**
- `TRANSCRIBE_API_KEY` — an API key from **[console.groq.com](https://console.groq.com)** (recommended: free tier, and Whisper transcription there is both very fast and very cheap) or **platform.openai.com** if you prefer OpenAI's Whisper.
- `TRANSCRIBE_BASE_URL` — optional, defaults to Groq (`https://api.groq.com/openai/v1`). Set to `https://api.openai.com/v1` to use OpenAI instead.
- `TRANSCRIBE_MODEL` — optional, defaults to `whisper-large-v3-turbo` (Groq's fast model). Use `whisper-1` for OpenAI.

Without `TRANSCRIBE_API_KEY` set, iPhone users simply keep the "type instead" fallback that already existed — nothing breaks, you just don't get the upgrade until you add the key. The mic caption in the booth tells the user honestly which mode they're in.

**Cost:** transcription is billed separately from your Claude usage (a different provider). Groq's Whisper is priced in fractions of a cent per minute of audio — for a language-learning app, a heavy daily user speaking 10 minutes/day costs a small fraction of what the Claude calls already cost. It shares the same `DAILY_AI_LIMIT`-style protection: the existing 30-req/min rate limit applies to `/api/transcribe` too.

---

## What's new in v4 (the coaching layer)

| Layer | What it does | Where |
|---|---|---|
| 🎯 **Il Coach** (Fluency Architect) | Reads your *actual* data — level, top gaps, cards due, spoken turns, exam history, streak — and prescribes exactly what to do **today**: 4 sequenced ~20-min steps, each with a why grounded in your numbers and a one-tap jump into the activity. Regenerates on demand, cached per day. | Oggi, top |
| 🗣 **Pronuncia** (Accent Surgeon) | Asks your native language once. English natives get a hand-built bank of the 7 sounds that expose you (rolled R, doppie, GLI, GN, pure vowels, C/G hard-soft, stress — with medical drill sentences); other L1s get an AI-diagnosed set. Each sound: why it gives you away, the physical fix, drills with 🔊 model / 🐢 slow / 🎙 **intelligibility test** — if Italian speech recognition mishears you, so does the barista. | Oggi → Pronuncia |
| 🧩 **Mental Model** (Grammar Unlocked) | On any gap in your gap map: the logic a native uses *without thinking* (no rule-memorizing), a 2-second litmus test, then 5 sentences that force you to apply it. Passing reduces the gap counter. | Lacune → 🧩 |
| 📦 **Vocab Packs** (Vocabulary Architect) | 8 real-life contexts — in corsia, dal medico, burocrazia, lavoro, casa, aperitivo, viaggio, emergenze. AI picks the 10 highest-leverage words for your level, each with the exact situation it fits + a memory hook, previewed then loaded into Ripasso. Skips what you already have. | Oggi → Vocab packs |
| 🧗 **Plateau Breaker** | Diagnoses *why* you're stuck from real usage data (input quality vs output avoidance vs comfort looping), then generates a 30-day discomfort protocol — one concrete escalating action per day, tracked on Oggi with a progress grid. | Oggi → Plateau |
| 🌿 **Booth: anti-script + naturalness** | The conversation partner now throws a plausible curveball every 3-4 turns so you can't rehearse, and flags phrasing that's *grammatically fine but unnatural* (green 🌿 chip) separately from grammar fixes (🔧). | Parla |

---

## What's new in v3 (the "sellable" build)

| Layer | What it does | Where |
|---|---|---|
| 🗺 **Lacune (gap map)** | Every error from the booth, Scrivi, sprints & drills is tagged against a 15-category taxonomy (passato prossimo vs imperfetto, congiuntivo triggers, essere/avere, clitics…). Counters, your own failed sentences as examples, and **Ripara** drills built from *your* mistakes. Clearing a repair drill lowers the counter. | Oggi → gap map card |
| 🔧 **Auto fix-cards** | Every 3rd hit on the same weakness spawns an SRS card built from your own wrong sentence: front = your error, back = the fix + the rule. | Ripasso |
| 🎓 **Esame simulator** | CILS/CELI-style prove at B1–C2: **Scritta** (12-min timed formal tasks incl. PEC, reclamo, istanza), **Orale** (4 exam questions, speak or type), **Ascolto** (native-speed TTS passage + MCQ), **Lettura** (authentic text + MCQ). Graded /5 on the real axes — lessico, grammatica, coerenza, adeguatezza — pass ≥ 12/20, honest CEFR verdict, history chart. Graded errors feed the gap map. B1 is the Italian citizenship requirement. | Oggi → Esame card |
| 🎯 **Scelta** | The tense-*choice* drill: not "how do I conjugate" but "**which** tense does this context demand". PP vs imperfetto, congiuntivo vs indicativo (with traps like *secondo me*), futuro epistemico, condizionale, essere/avere. Misses are tagged. | Oggi → bonus row |
| ⚡ **Vocab boost** | Curated high-frequency lemma list (connectors, discourse markers, verb collocations, bureaucratic survival vocabulary) tiered by level. +5/day into the SRS — maximum-yield words first. | Oggi + empty Ripasso |
| 🧠 **Smarter SRS** | Mature cards (interval ≥ 7d) flip to **production** direction: English shown, you produce the Italian (typed check optional). Leech detection: 4+ lapses flags the card and regenerates its mnemonic. Good/Easy grades heal lapses. | Ripasso |
| 🛂 **Bureaucratic Italian** | New booth scenarios: **In questura / all'anagrafe** (B1) and **La telefonata formale** (B2) — sportello register, Lei form, marca da bollo & friends. Formal-writing exam tasks match. Frequency list includes permesso/anagrafe/raccomandata vocabulary. | Parla + Esame |
| 💸 **Cost guardrail** | Optional `DAILY_AI_LIMIT` env var: per-IP daily cap on AI calls (on top of the existing 30/min limit) so a shared or sold deployment can't drain your key. | server.js |

---

## 1 · Run it — free hosting that's actually free (verified July 2026)

The app needs a small **Node server** (API-key proxy, iOS transcription, logins) + **Postgres** for cloud sync. The free landscape changed a lot in 2026 — Koyeb closed its free tier to new users after the Mistral acquisition, Fly.io's free tier is gone, Railway is a one-time $5 trial — so here's what genuinely works today:

**Database (all options):** [Neon](https://neon.tech) free Postgres — generous, doesn't expire, copy the connection string into `DATABASE_URL`. (Avoid Render's free Postgres: it expires after 30 days.)

**Option A — Render free web service** *(simplest; you're already set up there)*
Render's free tier still includes web services — you're only charged if the service is on a paid instance type. In the dashboard: your service → Settings → Instance Type → **Free**. Trade-off: it spins down after ~15 min idle and takes ~1 min to wake on the next visit — you said that's acceptable. 750 free instance-hours/month covers one service running 24/7.

**Option B — Northflank free Developer plan** *(free AND always-on)*
2 services, 1 vCPU, 1 GB RAM, **no cold starts** on the free plan. Requires a credit card on file but costs nothing within the plan. Connect the GitHub repo or use the included `Dockerfile`. Currently the best "free without the wake-up delay" option.

**Option C — Google Cloud Run** *(most generous quota, seconds-not-minutes cold starts)*
~2M requests/month free. Scale-to-zero like Render, but wake-up is a few **seconds**, not a minute. Deploy with the included `Dockerfile`: `gcloud run deploy fluente --source . --allow-unauthenticated`. Needs a Google billing account on file (stays $0 within free quota).

**Setup on any of them** — add the secrets/environment variables:
- `ANTHROPIC_API_KEY` = `sk-ant-...` (console.anthropic.com) — required
- `DATABASE_URL` — Neon connection string → enables logins + cross-device sync
- `TRANSCRIBE_API_KEY` — free at console.groq.com → enables the iPhone mic
- Optional: `CLAUDE_MODEL`, `DAILY_AI_LIMIT`, `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_MODEL`

💡 *Keeping Render awake:* a free uptime monitor (e.g. UptimeRobot) pinging your URL every 14 minutes prevents spin-down and fits inside the 750 free hours — a common pattern, though it burns your full monthly allowance on one service.

## 2 · Publish + install on phone

Deploy for a permanent URL. Then: **iPhone Safari** → Share → Add to Home Screen ·
**Android Chrome** → ⋮ → Install app. Full-screen PWA, offline shell, red metro F icon.

⚠️ Mic is native/instant on Chrome, Edge & Android. On iPhone/iPad Safari it now
works too, via server-side transcription — see "What's new in v5" above (needs
`TRANSCRIBE_API_KEY`). Without that key, iOS falls back to typing; 🔊 always works.

## 3 · Costs

Each lesson/turn ≈ one ~1k-token Claude call — a few cents/day per active user on
pay-as-you-go. Set a monthly spend cap in the Anthropic console. With `DAILY_AI_LIMIT`
set, worst-case cost per user per day is bounded and predictable.

## 4 · Selling it

Honest options, simplest first:

1. **Deploy-per-customer (concierge SaaS).** You deploy one instance per paying customer
   (or one shared instance with `DATABASE_URL` accounts), they pay you monthly
   (e.g. €7–12/mo — under an italki lesson, over Duolingo). Payments via Stripe Payment
   Links or Lemon Squeezy — no code needed to start; the `DAILY_AI_LIMIT` cap keeps
   margins safe. This is the fastest path to first revenue.
2. **Sell the app itself (one-time).** Zip + README on Gumroad/Lemon Squeezy as a
   "bring-your-own-API-key" product for self-hosters (€19–39). Zero marginal cost,
   zero support for API bills — buyers pay Anthropic directly.
3. **True multi-tenant SaaS.** Add Stripe subscriptions + per-account (not per-IP)
   metering in `server.js` — accounts already exist, so gating `/api/chat` on a
   `plan` column is a small step. Do this only after option 1 proves demand.

Positioning that differentiates it from Duolingo/Babbel: **exam outcomes** (CILS/CELI
simulation → citizenship & university requirements), **verticals** (medical Italian for
healthcare workers; bureaucratic Italian for expats), and **personal gap repair**
(the app drills *your* mistakes, not a fixed syllabus). Those are the three things the
big apps structurally don't do.

Before charging strangers: add a privacy note (state is localStorage + optional
Postgres you control) and a terms line; if selling to EU consumers, note GDPR basics
(export/delete = one SQL query on `fluente_users`).

## 5 · What's inside

| Piece | File |
|---|---|
| App (all of it) | `public/index.html` |
| AI proxy + rate limits + accounts | `server.js` |
| PWA install/offline | `public/manifest.json`, `public/sw.js` |
| Headless test suite (36 checks, dev-only) | `smoke.js` — `npm i jsdom --no-save && node smoke.js` |

## 6 · Tinkering map (everything is in index.html)

- `ERR_TAX` — the 15-category error taxonomy powering the gap map
- `SCELTA_BANK` — tense-choice drill items `[sentence, [A,B], answer, why, errType]`
- `FREQ_VOCAB` — frequency vocabulary `[it, en, minLevelIdx]`
- `WRITING_TASKS` — exam writing prompts per level
- `CURRICULUM`, `SCENARIOS`, `MED_DECKS`, `FILMS`, `DETTATO_BANK`, `SPRINT_BANK` — as before
- `:root` CSS variables — the design system

In bocca al lupo. 🐺
