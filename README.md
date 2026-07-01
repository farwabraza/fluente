# FLUENTE 🚇 — Italian, all the way to native

ADHD-first Italian fluency app. AI micro-lessons, a speech-recognition speaking booth,
a **gap-detection engine** that maps your personal weaknesses from every mistake you make,
a **CILS/CELI exam simulator** graded on the real rubric, medical & bureaucratic Italian,
dictation, verb sprints, tense-choice drills, frequency-ranked vocabulary, and an SRS
with mnemonics, leech rescue, and production-direction recall.

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

## 1 · Run it (5 minutes)

Works on Replit, Render, Railway, Fly — anything that runs Node 18+.

1. Upload this folder (keep structure: `server.js`, `package.json`, `.replit`, `public/`).
2. Add the secret / environment variable:
   - `ANTHROPIC_API_KEY` = `sk-ant-...` (from console.anthropic.com → API Keys)
3. Run. That's it — the key lives only on the server; the browser never sees it.

Optional env vars:
- `CLAUDE_MODEL` — defaults to `claude-sonnet-4-5`. Check current names/pricing at https://docs.claude.com
- `DATABASE_URL` — Postgres connection string (free at neon.tech) → enables username+PIN cloud sync across devices
- `DAILY_AI_LIMIT` — e.g. `150` → per-IP daily cap on AI calls (0/unset = off)

## 2 · Publish + install on phone

Deploy for a permanent URL. Then: **iPhone Safari** → Share → Add to Home Screen ·
**Android Chrome** → ⋮ → Install app. Full-screen PWA, offline shell, red metro F icon.

⚠️ Mic works best in Chrome/Edge; iOS Safari speech recognition is partial — typing in
the booth is identical and 🔊 always works.

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
| Headless test suite (16 checks, dev-only) | `smoke.js` — `npm i jsdom --no-save && node smoke.js` |

## 6 · Tinkering map (everything is in index.html)

- `ERR_TAX` — the 15-category error taxonomy powering the gap map
- `SCELTA_BANK` — tense-choice drill items `[sentence, [A,B], answer, why, errType]`
- `FREQ_VOCAB` — frequency vocabulary `[it, en, minLevelIdx]`
- `WRITING_TASKS` — exam writing prompts per level
- `CURRICULUM`, `SCENARIOS`, `MED_DECKS`, `FILMS`, `DETTATO_BANK`, `SPRINT_BANK` — as before
- `:root` CSS variables — the design system

In bocca al lupo. 🐺
