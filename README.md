# FLUENTE 🚇 — Italian, all the way to native

ADHD-first Italian fluency app. AI micro-lessons, a speech-recognition speaking booth,
medical Italian for the corsia, dictation, verb sprints, SRS with mnemonics, and a
metro-map curriculum from A1 to C2.

---

## 1 · Put it on Replit (5 minutes)

1. Go to **replit.com** → **Create Repl** → choose **Node.js**.
2. Delete the starter files and upload everything in this folder
   (keep the structure: `server.js`, `package.json`, `.replit`, and the `public/` folder).
   Easiest way: drag the whole unzipped folder into the Replit file panel.
3. **Add your API key (the only setup step that matters):**
   - Get a key at **console.anthropic.com** → API Keys → Create Key.
   - In Replit: left sidebar → **Tools → Secrets** → add:
     - Key: `ANTHROPIC_API_KEY`
     - Value: `sk-ant-...` (your key)
4. Press **Run**. The app opens in the webview. Done.

> The key lives only on the server (Replit Secrets). The browser never sees it —
> that's why this build has a `server.js` instead of calling the API directly.

## 2 · Publish it (so it has a real URL)

- In Replit, click **Deploy** (top right) → **Autoscale** → Deploy.
- You get a permanent URL like `fluente.yourname.repl.app`.
- Free/dev URLs sleep when idle; a deployed app stays up. Either works —
  the deployed one is nicer for daily phone use.

## 3 · Install it on your phone (PWA)

**iPhone (Safari):** open your app URL → Share button → **Add to Home Screen**.
**Android (Chrome):** open the URL → ⋮ menu → **Install app** / Add to Home screen.

It installs full-screen with the red F icon, keeps your progress
(stored on-device in localStorage), and the app shell works offline —
only the AI features need a connection.

⚠️ **Mic note:** speech recognition works best in **Chrome/Edge (desktop & Android)**.
iOS Safari support is partial — if the mic button doesn't respond, typing in the
booth works identically and the 🔊 listening side always works.

## 4 · Costs

Each lesson / conversation turn is one small Claude API call (~1k tokens).
Realistic daily use is a few cents a day on pay-as-you-go. The server includes
a per-IP rate limit (30 req/min) so a shared URL can't drain your credits.
You can set a monthly spend cap in the Anthropic console — do it.

To switch models, add a Secret `CLAUDE_MODEL` (defaults to `claude-sonnet-4-5`).
Check current model names/pricing at https://docs.claude.com/en/api/overview

## 5 · What's inside

| Piece | File | What it does |
|---|---|---|
| App (all of it) | `public/index.html` | UI, lessons, booth, SRS, dettato, sprint |
| AI proxy + rate limit | `server.js` | Holds your key, forwards to Claude |
| PWA install | `public/manifest.json`, `public/sw.js` | Home-screen install + offline shell |
| Icons | `public/icon-*.png` | The red metro F |

Progress is per-device (localStorage). If you reinstall or switch phones it resets —
cloud sync would be the next upgrade (a `/api/state` endpoint + Replit DB).

## 6 · Tinkering map (everything is in index.html)

- `CURRICULUM` — add/rename stations on the Linea
- `SCENARIOS` — add speaking-booth scenes (the system prompt builder is `convoSystem`)
- `MED_DECKS`, `ANAMNESI` — medical content
- `FILMS` — the cinema catalog
- `DETTATO_BANK`, `SPRINT_BANK` — drill content
- `:root` CSS variables — the whole design system

In bocca al lupo. 🐺
