# FLUENTE — structure & outline

A reorganization of what already exists. No new features. Nothing deleted.
Written before any code, so the shape gets agreed first.

---

## 1 · What's there today, counted

| | |
|---|---|
| Tabs in the bottom nav | **7** |
| Tappable choices on the landing screen (Oggi) | **16** |
| Distinct activities reachable in the app | **~20** |
| Screens with 6+ choices | **9 of 16** |

Measured from `public/index.html`: `renderOggi` alone wires 16 `onclick`
handlers. `renderLinea` 10, `renderLacune` 9, `renderSRS` 8, `renderPronuncia` 8.

**The first thing you see after logging in asks you to make sixteen decisions.**

---

## 2 · Why it overwhelms

Not because there's too much *content*. Because of three structural choices:

**a. It's organized by feature, not by intent.**
The 7 tabs mix three different kinds of thing that should never sit side by side:

- things you **do** — Linea, Parla, Medicina, Cinema, Ripasso
- things you **look up** — Regole
- things that **measure you** — Lacune, Esame, Pronuncia

Then Oggi mixes all three again, which is why it has 16 taps.

**b. The landing screen is a dashboard.**
A dashboard is a list of things you have not done. Opening the app starts with
evidence of failure and a request to choose. Both are expensive; together they're
the reason the app gets closed.

**c. Activities are destinations.**
Parla, Cinema and Medicina are *formats* — ways of practising — but they're in the
nav as if they were places to visit. So every session starts with "which room?"
instead of "go".

---

## 3 · The budget

Four rules. Everything below follows from them. They are also the acceptance
test: if a screen breaks one, it's wrong.

1. **Nav: 3 items.** Not 7.
2. **The landing screen offers exactly one action.** Nothing else above the fold.
   No counts, no badges, no "you have 12 due".
3. **Any screen: one primary button.** At most 3 secondary, and they look secondary.
4. **Any list: 3 visible, rest behind "mostra tutto".**

A fifth, about wording rather than layout:

5. **Never display a quantity of undone work.** "12 carte da ripassare" is a debt
   notice. "4 minuti" is a task. Same data, opposite effect.

---

## 4 · The structure

```
LOGIN
  └─ ADESSO                      ← the only landing screen

┌─ ADESSO ──────────────────── tab 1
│  One card. Today's single task, already chosen. ~4 min.
│  [ Comincia ]
│
│  below the fold, only after you scroll:
│    · "ho più tempo" → reveals 2 more. Never 6.
│    · "non oggi"     → one tap, closes, costs nothing
└─

┌─ CORSO ───────────────────── tab 2
│  One vertical line of modules. Current one open, the rest collapsed.
│  module → its 3 lessons → a lesson
│  Nothing else on this screen. This is the "where is this going" screen,
│  for the days you want to look, not the days you want to do.
└─

┌─ IO ──────────────────────── tab 3
│  Where I am · what's weak (one line, not a map) · am I ready
│  Settings, account, modalità brutale
│  └─ "Tutto il resto" — the toolbox, as a searchable list.
│     Reachable. Not advertised.
└─
```

**The load-bearing change:** four of the seven tabs (Linea, Parla, Medicina,
Cinema) are activity *formats*, not places. They stop being destinations and
become things the course draws from — the coach picks "today is 5 turns in the
booth", and the booth opens. You can still go there on purpose, from the toolbox.

That single move takes the nav from 7 to 3 without removing anything.

---

## 5 · Where everything went

Nothing is deleted. Demoted ≠ gone.

| Today | Goes to | Why |
|---|---|---|
| **Oggi** (dashboard, 16 taps) | ADESSO, 1 tap | The one change that matters most |
| Il Coach | ADESSO — it *is* the card now | It already picks the task; let it |
| Le missioni (5/day) | ADESSO → "ho più tempo" | 5 missions = 5 decisions |
| La chicca di oggi | ADESSO → "ho più tempo" | Delightful, optional, not a duty |
| **Linea** (metro map) | CORSO | Same content, one column |
| Il placement test | First run only | Not a permanent tab item |
| **Parla** (booth) | A lesson format + toolbox | Format, not a place |
| **Medicina** | A lesson format + toolbox | Format, not a place |
| **Cinema** | A lesson format + toolbox | Format, not a place |
| **Regole** (26 rules) | IO → Tutto il resto | Reference. Looked up, not browsed |
| La regola di oggi | ADESSO, when the coach picks it | Already works this way |
| Il coniugatore | IO → Tutto il resto | A tool, used on demand |
| **Ripasso** (SRS) | A lesson format + toolbox | The coach schedules it |
| Lacune / gap map | IO — as **one line**, not a map | "Il congiuntivo. 8 errori." |
| Esame simulator | IO — "sono pronto?" | The readiness question |
| Pronuncia | IO → Tutto il resto | Occasional, not daily |
| Vocab packs | IO → Tutto il resto | Occasional |
| Plateau breaker | IO → Tutto il resto | Occasional |
| Dettato, Sprint, Scelta, Scrivi | Lesson formats + toolbox | Drills, not destinations |
| Modalità brutale | IO → settings | A preference |

---

## 6 · Not decided yet

- Does CORSO show one course, or the three audience tracks (lavoro / medicina /
  fluente)? Structure works either way; picking one changes onboarding.
- Does "Tutto il resto" need search, or is a plain list of ~13 items enough?
- What ADESSO shows on a day with nothing due — rest day, or always something.

---

## 7 · Not in scope here

The accountability layer (the pact, the weekly amnesty, study windows, soft
re-entry) is a separate question from structure. It belongs in ADESSO and IO once
the shape above is agreed — not before.
