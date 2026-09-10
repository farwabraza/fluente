# FLUENTE 🚇 — Italian, all the way to native

ADHD-first Italian fluency app. AI micro-lessons, a speech-recognition speaking booth,
a **gap-detection engine** that maps your personal weaknesses from every mistake you make,
a **CILS/CELI exam simulator** graded on the real rubric, medical & bureaucratic Italian,
dictation, verb sprints, tense-choice drills, frequency-ranked vocabulary, and an SRS
with mnemonics, leech rescue, and production-direction recall.

---

## What's new in v7.0 — la rotta, the bot that reaches out, instant lessons, modalità bambino

Built for the learner who "never checks the app": v7 is about the app **coming to you**, opening **instantly**, knowing **where you're going**, and taking the **English away** one notch at a time. Every piece is a toggle; nothing changes what you already had unless you turn it on. (`main` still holds v6.8; the commit before all of this is tagged `v6.8-pre-paywall`.)

### 🧭 La rotta — six questions that reshape the app
Reached from the placement result, or any time from the **Rotta** row on Oggi. One question per screen: **where you must arrive** (the medical ladder — **B1** for clerkships from year 2 · **B2** for year-3 admission *and* Ordine dei Medici registration · **C1** CILS/CELI for the specialization concorso · madrelingua · B1 citizenship) → exam type + date → how you study (bursts vs blocks, which skills) → what always trips you (chips from the gap taxonomy) → minutes per day → **the pact** (time, anchor like "dopo il caffè", days, how to be reminded). What it changes: the Linea marks **🏁 la tua meta** and "oltre la meta"; Esame defaults to your target; Oggi shows a countdown and sizes the day's required missions to your minutes (a "perfect day" must be reachable on a bad day — 5 minutes = the micro-session only); declared struggles are **pre-seeded into the gap map** so Ripara and La Regola di Oggi start from you on day one; the coach gets your goal, deadline and minutes, and on ≤5-minute days prescribes **without AI** (`coachFallback()`, also used when the coach is unreachable).

### ⏱ La sessione minima — 2 minutes, zero AI, zero waiting
One due card, two Scelta items (misses tagged in the gap map), one dettato sentence shadowed. +10 XP, counts for the streak. Always the first row on Oggi, and what every reminder deep-links to (`?go=micro`).

### 🔔 The Telegram bot that reaches out (needs 10 minutes of setup)
The app never initiated contact; now an hourly cron makes a bot write to you **at the pact hour if you haven't done anything yet**, again **at 21:00 if still nothing**, and on **Mondays with the week's pagella** (XP, active days, streak, gap n.1, days to the exam). Every message opens the micro-session. Tone follows your own Modalità Brutale switch — gentile 😇 or brutale 🔥 (the bot roasts the skip, never you: *«Alle 08:15 dovevi aprire Fluente, non Instagram. Sessione minima, ORA.»*). Reply `fatto` when you studied outside the app, `/oggi` for status, `/stop` to silence it. Linking is 3 taps from **Oggi → Promemoria**.

Setup: create a bot with [@BotFather](https://t.me/BotFather) (`/newbot` → copy the token and the username), then set on the server: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME` (without @), `CRON_KEY` (any long random string), `APP_URL` (your public URL), optionally `TELEGRAM_WEBHOOK_SECRET`. Open once `https://<your-app>/api/telegram/setup?key=<CRON_KEY>` to register the webhook. Then point a free scheduler (cron-job.org, GitHub Actions `schedule`, UptimeRobot with a URL) at `https://<your-app>/api/cron/nudge?key=<CRON_KEY>` **every hour** — this ping also keeps a free-tier server awake. Add `&dry=1` to preview who would get what without sending. Requires `DATABASE_URL` (accounts) — the bot needs to know who you are.

### ⚡ Instant lessons — 29 hand-written stations (`public/banks.js`)
Every non-exam station on the Linea now opens **instantly, offline, with no Claude call**: hand-authored concept, English bridges, mnemonic, nota, speak task, cards, and a **10-drill pool per unit** — each drill tagged with a gap-map key, so lesson misses finally feed Ripara like every other drill. Five drills are picked per visit with a seeded rotation (two consecutive visits cover all ten; then a fresh order). On a repeat visit, **🔄 Nuove domande** asks the AI for five brand-new ones (~900 tokens instead of the old 3,200-token lesson) and keeps them in the rotation. Checkpoints and the **prova orale** draw their questions from `CHECKPOINT_QS` / `ORALE_BANK` (no repeats until a bucket is used up); grading stays AI. Any unit you add to the curriculum without a bank entry still gets the AI lesson — now cached, so REVIEW never regenerates.

### 🧒 Modalità bambino — the scaffold-fade
Children don't translate: they get comprehensible input, chunks and recasts. The English bridges are the right scaffold at the start; the **Modalità bambino** row on Oggi takes them away a notch at a time — **0 Ponte** (as before) · **1 Sussurro** (English behind a tap: booth translations, lesson bridges, card backs, chicca) · **2 Italiano** (no translations; cloze cards from the example sentence, production direction at 3 days instead of 7, the AI explains in simple Italian and the booth corrects by *recasting*) · **3 Madrelingua** (no English anywhere). Every AI prompt carries the override (`langRules()`, zero extra tokens); the rulebook stays in English on purpose (it's a manual). Dettato gained a **🎙 shadowing** step at every level. Passing a checkpoint suggests the next notch.

### Also
- `today()` is now the **local** calendar day (it was UTC — in Italy anything between 00:00 and 02:00 counted as yesterday, which quietly corrupted streaks and would have fought the reminders).
- Streak **freezes** ❄️: one skipped day is covered if you have one (earned every 7 days, max 2); two skipped days reset; best streak tracked; Oggi says *"Ieri hai saltato. Una sola. Oggi conta doppio."*
- Cards from a lesson are no longer duplicated when you REVIEW a station.
- `node smoke.js` → 83 jsdom checks · `node smoke-server.js` → 15 server checks (boots the real server dormant and enforced, no DB needed).

---

## What's new in v6.9 — ✦ Pro paywall (dormant)

The paid tier exists in the code but **does nothing until you switch it on**. With no new environment variables set, v6.9 behaves exactly like v6.8 for every user: no Pro rows, no locks, no refused calls. The one visible-only-to-you change is a per-feature cost line in the server log (`[ai] esame_scritta farwa in=812 out=390`), which is the data you need to price Pro.

**What's inside (all inert while dormant)**

- **Server-owned plan.** `fluente_users` gains `plan`, `plan_until`, `email`, `token_hash`, `mor_customer_id` (added automatically with `ALTER TABLE … IF NOT EXISTS`; the client can never write these — `state` stays client-owned).
- **Identity on AI calls.** `/api/auth` now also returns a bearer token (only its hash is stored); the app sends it with every `/api/chat` call together with a `feature` tag (`esame_scritta`, `coach`, `parla`, … — all 26 call sites are tagged).
- **The wall** (`PRO_ENFORCE=1` only): outcome features are Pro — the four exam prove, Plateau Breaker, Vocab Packs, Mental Model, accent diagnosis, AI-built lessons — and refuse with `402 pro_required` for free accounts. Habit features stay free with a daily allowance (`parla` 20 turns, `ripara`/`scrivi`/`coach` 1 each). Lessons from the rulebook, Ripasso, Chicca, Scelta/Sprint/Dettato and the gap map never touch the wall.
- **Client gate + upgrade sheet.** `gate(feature, fn)` is a pass-through while dormant. When enforced: ✦ PRO marks on gated rows, a "FLUENTE Pro" row on Oggi, a ✦ PRO pill in the header for subscribers, and an upgrade sheet with the checkout link (carrying the username so the purchase maps to the account) and a "Già Pro? Aggiorna" refresh.
- **Payment webhook** `POST /api/webhook/mor` in Lemon Squeezy format (`X-Signature` = HMAC-SHA256 of the raw body): `subscription_created/updated/resumed/payment_success` → `plan='pro'` until `renews_at`; `cancelled/expired/paused/payment_failed` → access continues until `ends_at`, then free. Matches the account by `custom_data.username`, else by e-mail.
- **Tests:** `node smoke.js` (63 jsdom checks) and `node smoke-server.js` (13 checks that boot the real server dormant *and* enforced, no DB needed).

**Flip it on (three env vars) — and off again**

1. `PRO_ENFORCE=1` — the wall exists. Unset it (or set `0`) to go back to fully free; nothing else needs to change and no data is lost.
2. `CHECKOUT_URL` — your Lemon Squeezy (or Paddle) checkout link for the €9,99/month product.
3. `MOR_WEBHOOK_SECRET` — the signing secret of the webhook you point at `https://<your-app>/api/webhook/mor` (subscribe it to the `subscription_*` events).

To grant Pro by hand (a friend, a teacher, yourself): `UPDATE fluente_users SET plan='pro', plan_until=0 WHERE username='farwa';` — `plan_until=0` means no expiry.

**Getting paid from Italy without Stripe** — the blocker is not Stripe, it's the partita IVA. A merchant of record (Lemon Squeezy, Paddle) is the legal seller: it invoices the customer, remits EU VAT and pays you out, and you can sign up with a codice fiscale. On the tax side, a monthly subscription is *habitual* income, so "prestazione occasionale" (≤ €5 000/year, non-habitual) is not the right box for it: open a **partita IVA in regime forfettario** (ATECO 62.01.00 software; 5 % substitute tax for the first five years on 67 % of revenue, INPS Gestione Separata on the same base; ~€0 to open, an online commercialista runs ≈ €300–500/year). Worked example at €1 000/month gross: MoR fee ≈ €55 → taxable base ≈ €633 → INPS ≈ €165 → tax ≈ €23 → **≈ €750/month net**. Confirm the details with a commercialista; forfettario is unavailable if last year's employee income exceeded €35 000.

**Going back to the old version entirely:** `main` still holds v6.8 unchanged and the commit before this change is tagged `v6.8-pre-paywall`. Deploy `main`, or `git revert` the merge — your data is untouched either way (the new columns are simply ignored).

---

## What's new in v6.8 — 🔥 Modalità Brutale (opt-in roast mode)

Inspired by apps where the AI roasts your mistakes so hard you never make them again. Off by default; one tap on the **Modalità brutale** row (on Oggi or in Regole) arms it everywhere:

- **Instant drills** (lesson drills, rule drill ×5, trigger drill, Scelta, Verb Sprint): wrong answers get flamed with a line from a hand-written bank of 22 colloquial Italian roasts — parolacce included — each with a tiny English gloss, so the insult is itself listening practice («Anche il mio gatto lo sapeva. E non ho un gatto.»). Right answers earn grudging praise («Miracolo. Segna la data.»).
- **AI corrections** (booth conversations, Scrivi, Crea la tua frase): the models get a one-sentence tone order to correct you like a foul-mouthed Italian best friend — roast the mistake, never the person, correction stays precise. In the booth only the `fix`/`nat` chips get brutal; the in-character reply stays in character.
- **Zero extra cost:** drill roasts are client-side (no API call), and the AI tone rides on prompts that already run.

(57 automated checks.)

---

## What's new in v6.7 — English bridges, il metodo & la chicca

Built for how this learner actually thinks: they *speak* decent Italian and understand English perfectly, but don't carry grammar terminology in either language — and their notes follow an ADHD method (one line, one idea, a hook).

1. **🌉 Il Ponte — English parallels everywhere.** Every one of the 26 rules now has a hand-written *bridge*: 2 side-by-side pairs proving "you already say this in English" — the English construction shown as a quoted specimen sentence (never named with jargon), mapped straight onto the Italian. AI lessons and the verb tutor got the same standing order: *never explain by naming tenses — show the matching English construction in quotes* ("it's the 'I had done' move"), and lessons now generate their own bridge pairs.
2. **📝 La Nota — the ADHD note line.** Every rule (and every AI lesson) now carries one compressed copy-into-your-notebook line — rule core + hook + micro-example, sticky-note styled. It's also the recall anchor for step 2 of il metodo.
3. **🔁 Il Metodo — the same practice pattern on every rule.** Read the story → **Copri & ricorda** (cover the note, say the rule + an example out loud, flip, honest self-grade) → **Drill ×5** (existing AI drill; 4/5 earns the dot) → **Crea la tua frase** (write one sentence about *your* life using the rule; AI checks it, catches rule-dodging, feeds mistakes to the gap map). Progress dots ●●○ live on every rule row, and **La Regola di Oggi** at the top of Regole picks your worst gap-mapped rule (or rotates daily) so there's never a "where do I start".
4. **🍋 La Chicca di Oggi — one colloquial thing a day.** A hand-authored bank of 46 colloquial phrases, idioms and cultural facts (boh, magari, mi raccomando, the cappuccino-after-11 rule, why you answer *Crepi!*, why the phone is answered "ready!"…) rotating daily on the Oggi dashboard: 30 seconds, +5 XP, audio, the story behind it, one tap to add it to Ripasso, "un'altra →" to keep browsing.

(53 automated checks.)

---

## What's new in v6.6 — connection-failure fixes (multi-user reliability)

Reported symptom: "building the lesson" / booth turns failing with a connection error, two people using the app. Three compounding causes, all fixed:

1. **Anthropic API rate limits (the main one).** Lesson generation is a large call; two people at once can hit the per-minute limits of lower API tiers → HTTP 429. The server now **retries 3× with backoff, honoring Anthropic's `retry-after` header** — most 429s and 529 "overloaded" moments now recover invisibly. If retries are exhausted, the app shows an honest message naming the cause instead of "connection issue". *If it keeps happening at your usage level, check your tier limits at console.anthropic.com → Limits — moving up a tier raises tokens/minute.*
2. **Free-tier cold starts hidden by the app shell.** The PWA loads instantly from cache while the free server behind it is still waking (~1 min on Render Free) — so the first lesson call hung. The app now **pings `/api/health` the moment it opens**, waking the server while the person is still on the dashboard; the client also detects a sleeping server mid-call, shows "il server si sta svegliando… riprovo ⏳", pokes it, and retries with a 90-second budget instead of hanging.
3. **Shared per-IP rate limit.** Two people on the same WiFi share one public IP — the old 30 requests/minute guard was shared between them. Default raised to **60/min**, configurable via the `RATE_LIMIT_PER_MIN` env var.

Also fixed: navigating away from the booth while a reply was in flight could throw a silent error. (43 automated checks, including a live HTTP proof that a 429→retry→200 sequence delivers the lesson.)

---

## What's new in v6.5 — La Grammatica (the rulebook)

The Verbi tab is now **Regole (§)** — a complete, hand-written grammar rulebook: **26 rules** across *I Tempi* (all 15 tenses/moods: presente through congiuntivo trapassato, periodo ipotetico, imperativo, gerundio) and *La Struttura* (essere/avere + agreement, the agreement chain, clitic pronouns, ci & ne, articles, prepositions, piacere-verbs, si impersonale, negation & word order, comparatives, relatives). Every rule opens as a full story:

- **≈ In English** — the equivalent construction when one exists (and the honest "English dropped this" when it doesn't)
- **When** — the actual triggers, as scannable cards
- **How** — the formation machinery
- **Why it makes sense** — the underlying logic (photo vs video, reality-stamps, the anonymous subject…)
- **The trap** — the classic mistake, named
- **In the wild** — natural examples with audio
- **Drill this rule →** — 5 AI-built questions targeting exactly that rule (with at least one built on the trap); passing reduces the matching gap-map counter, misses feed it

Rules you keep failing are flagged red with your live error count straight from the gap map — the rulebook and your mistakes are one system. The congiuntivo chapter embeds the full VEDONO trigger walkthrough; the conjugator, trigger drill, sprint, and Scelta all live at the bottom as tools. All content hand-authored (not AI-generated) for accuracy.

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
- Optional: `CLAUDE_MODEL`, `DAILY_AI_LIMIT`, `RATE_LIMIT_PER_MIN`, `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_MODEL`
- Pro paywall (leave unset to stay fully free — see "What's new in v6.9"): `PRO_ENFORCE`, `CHECKOUT_URL`, `MOR_WEBHOOK_SECRET`
- Telegram reminders (see "What's new in v7.0"): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME`, `CRON_KEY`, `APP_URL`, optional `TELEGRAM_WEBHOOK_SECRET` — plus an hourly ping to `/api/cron/nudge?key=…`

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
3. **True multi-tenant SaaS — already scaffolded (v6.9).** Per-account metering, a `plan`
   column, feature gating on `/api/chat` and a merchant-of-record webhook are in `server.js`,
   dormant. Set `PRO_ENFORCE=1`, `CHECKOUT_URL` and `MOR_WEBHOOK_SECRET` to switch it on.

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
| App | `public/index.html` |
| Hand-written lesson, checkpoint and exam-orale banks | `public/banks.js` |
| AI proxy + rate limits + accounts + Telegram nudges/cron + dormant Pro wall + payment webhook | `server.js` |
| PWA install/offline | `public/manifest.json`, `public/sw.js` |
| Headless test suite (83 checks, dev-only) | `smoke.js` — `npm i jsdom --no-save && node smoke.js` |
| Server smoke test (15 checks, boots server.js dormant + enforced) | `smoke-server.js` — `node smoke-server.js` |

## 6 · Tinkering map (app in index.html, content banks in banks.js)

- `LESSON_BANK` (banks.js) — the 29 hand-written stations: concept/bullets/examples/bridge · mnemonic · note · 10 drills `{q, options[4], answer, why, err}` (err = a gap-map key) · speak · newcards. Add a unit to `CURRICULUM` without a bank entry and it falls back to the AI lesson.
- `CHECKPOINT_QS` / `ORALE_BANK` (banks.js) — checkpoint and prova-orale questions per level; `int:` themes a checkpoint question on an interest chip
- `NUDGE` (server.js) — the gentile/brutale Telegram message bank; `{name} {slot} {anchor} {streak} {due} {gap} {link}` are filled in
- `ROTTA_GOALS`, `BAMBINO`, `requiredMissions()` — the ladder, the dial, and how many missions a day needs

- `GRAMMAR_BOOK` — the 26-rule grammar rulebook (hand-written; edit freely — each rule: `note` one-liner, `bridge` English parallels, when/how/why/trap/examples)
- `CHICCA_BANK` — the 46 daily colloquial phrases & facts (hand-written; add your own)
- `ROAST_BANK` / `ROAST_PRAISE` — the Modalità Brutale insult & grudging-praise lines (hand-written; make them meaner)
- `ERR_TAX` — the 15-category error taxonomy powering the gap map
- `SCELTA_BANK` — tense-choice drill items `[sentence, [A,B], answer, why, errType]`
- `FREQ_VOCAB` — frequency vocabulary `[it, en, minLevelIdx]`
- `WRITING_TASKS` — exam writing prompts per level
- `CURRICULUM`, `SCENARIOS`, `MED_DECKS`, `FILMS`, `DETTATO_BANK`, `SPRINT_BANK` — as before
- `:root` CSS variables — the design system

In bocca al lupo. 🐺
