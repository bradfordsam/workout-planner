# Case study: how well the scheduling engine balances muscle groups

Generated from `node analysis/case-study.js` — 7 headless 10-week simulations of the
real generation code (`genProgram` → `dayTemplate` → `buildSession` → `pickEx`)
extracted verbatim from `index.html` and driven with a mocked clock. Raw numbers:
`analysis/case-study-data.json`. Actionable items: `analysis/FINDINGS.md`.

## Verdict

The engine is **excellent at recovery spacing and safety, and weak at volume
sufficiency and its own strength/accent goals**. Across 420 simulated sessions:

- **Zero** recovery-lockout violations, **zero** hip-risk/avoid-list/plyometric picks,
  **100%** lunch set-rule and low-sweat compliance, and every mandate that actually
  fired was fulfilled 100% with zero drops. The debt engine also degrades gracefully
  when 20% of sessions are skipped.
- But weekly volume lands **in the MRV band only 14%** of (muscle, week) cells on the
  default schedule and **46%** on a full lunch+evening schedule; the heavy 1–5
  strength mandate **never fired once** in any schedule that includes lunch sessions;
  the power/eccentric/decel accent rotation fired **zero times in all 7 scenarios**;
  and biceps average **0.9 sets/week** on the default schedule because the biceps
  pool contains no compound movement.

## Methodology

- Sim loop mirrors the app: generate week Monday morning, take each planned session
  (lunch 12:30, evening 18:00), append a `finishWorkout`-shaped log (every planned
  set completed at 8 reps), regenerate after every session (as `replanCurrentWeek`
  does), repeat for 10 weeks. Anchor Monday 2026-01-05; local timezone.
- Fidelity caveats: perfect adherence (except S6), no cardio/VO2/custom workouts,
  `recentWorkouts` empty, no weight progression, fatigue rating fixed per scenario.
- Scenarios: S1 default lunch-M–F; S2 +Tue/Thu/Sat evenings; S3 evenings M/W/F only
  (efficiency mode); S4 fatigue 5 every session; S5 fatigue 5 + 8h sleep logged;
  S6 = S2 with ~20% sessions skipped (seeded PRNG); S2t = S2 with the 60-log
  retention cap applied after every session. S7 (seeded from Sam's real `wp3`
  export) is pending the export.

## Scenario scorecard

| Metric | S1 default | S2 full | S3 3-day | S4 fatigue | S5 shield | S6 missed | S2t cap60 |
|---|---|---|---|---|---|---|---|
| Sessions taken | 50 | 80 | 30 | 50 | 50 | 61 | 80 |
| Volume in band (muscle-weeks) | **14%** | **46%** | **100%** | 14% | 14% | 32% | 46% |
| Lockout violations | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Heavy 1–5 weeks (strength tag) | **0/10** | **0/10** | 10/10 | 0/10 | 0/10 | 0/10 | 0/10 |
| Leg accent conversions (power/ecc/decel) | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Freq-cap breaches (rolling 7-day windows) | 0 | **48** | 0 | 0 | 0 | 16 | 48 |
| Safety (hip/avoid/lunch-sweat) breaches | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Weekly volume vs MRV bands (steady-state mean, weeks 2–10)

| Muscle | Band | S1 | S2 | S3 (band 3–10) |
|---|---|---|---|---|
| legs | 14–24 | 5.4 (100% under) | 9.0 (100% under) | 4.3 ✓ |
| back | 12–22 | 6.3 (100% under) | 9.9 (100% under) | 4.3 ✓ |
| chest | 10–20 | 5.0 (100% under) | 11.0 ✓ | 6.0 ✓ |
| shoulders | 8–18 | 4.0 (100% under) | 8.0 (78% in) | 4.7 ✓ |
| biceps | 6–16 | **0.9** (100% under) | 5.9 (44% in) | 3.0 ✓ |
| triceps | 6–16 | 3.2 (100% under) | 8.0 ✓ | 4.7 ✓ |
| core | 8–18 | 10.1 ✓ | **19.2 (100% OVER)** | 9.0 ✓ |

The arithmetic: a lunch session is capped at 3 exercises / 3+2+2 = 7 sets, so
lunch-M–F supplies ~35 sets/week against ~64 sets of summed muscle minimums. The
generator cannot reach the bands it is scored against — every muscle except core
(which has a forced slot in every session) sits permanently "yellow". S3 is the
mirror image: the 3-day trigger collapses the bands to 3–10 and everything scores
100% in-band. Only the 3-day schedule has self-consistent bands.

## Recovery spacing (the engine's strong suit)

Minimum observed cross-day gaps ride exactly on the lockout limits with zero
violations in every scenario: legs 72h/72h-limit, back 48h/48h, core 24h/24h.
Chest/shoulders median 120h (the debt race starves them slightly — consistent with
their under-min volume). In S6, skipping 19 of 80 sessions produced no violations
and proportional volume loss with partial in-band recovery — the day-by-day
recovery-debt design absorbs disruption exactly as intended.

## Mandates: fulfilled when they fire — but two never fire, and one can't fire

- **Fired & fulfilled 100%**: lunch hinge (S1 8/8, S2 20/20), back horizontal
  (S1 16/16, S2 27/27), evening strength in S3 (15/15). Zero mandate slot drops
  anywhere.
- **Never fires with lunch in the schedule**: evening `strength` (heavy 1–5).
  Lunch's own hinge mandate re-trains legs every ~3 days, so legs never build
  enough hours-of-debt to win an evening template slot; all evening leg volume
  arrived via the untagged backfill pass (tendon-work squats). Sam's primary
  leg goal is structurally unreachable on his real schedule shape.
- **Effectively never fires**: `hamstring` (needs a 2nd leg slot in one session —
  3 occurrences in 70 S1 days, 0 in S2) and `rear_delt` (needs a 2nd back slot —
  0 occurrences across all 490 simulated sessions). Knee-flexion and rear-delt
  work is left to chance, which is exactly what the code comments say these
  mandates exist to prevent.

## Rotation & variety

- **Core 5-tag cycle: perfect** — exactly 10/10/10/10/10 across S1's 50 sessions.
- **Leg accent rotation (power/eccentric/decel): dead in practice.** It converts an
  *untagged isolation* slot, but 40–60-min sessions have 2–3 muscle slots that are
  all first-appearance compounds — no isolation slot ever exists to convert. 0
  conversions in 490 sessions. The `powerPreferred` core fallback does fire (med
  ball slams/throws appear regularly), which is the only explosive work programmed.
- **Variety is pool-limited for arms.** `tricep_dips` is the only compound triceps
  movement, so it was picked 13–31× per scenario, breaching the 2-per-week cap in
  48 rolling windows in S2 (the cap relaxes rather than dropping the slot — by
  design, but silent). The biceps pool (4 movements, all isolation) cannot fill a
  compound slot at all: day names advertised "· Biceps" while the session contained
  no biceps exercise (the dropped slot was backfilled with another muscle).

## Fatigue clamp & sleep shield

S5 (fatigue 5 + 8h sleep) is **bit-identical to S1** — the sleep shield fully
neutralizes the fatigue penalty, as designed. S4 (fatigue 5, no sleep log) altered
exercise selection slightly but not band outcomes (everything was under minimum
anyway). The 0.85 MRV-max clamp only bites when volume approaches the ceiling,
which the default schedule never does.

## Retention cap

S2t (logs truncated to `LOG_KEEP=60` after every session) is **identical to S2** in
every metric — the generator's longest lookback is 7 days (frequency) / 72h
(lockout, fatigue) / 1 week (MRV), all comfortably inside 60 entries. The
10 → 60 retention fix fully closed the old truncation-fidelity gap.

## Addendum (2026-07-16): after the fixes

All findings except cosmetic F-08 were fixed and re-verified (outcomes inline in
`FINDINGS.md`). Headline before → after, 10-week runs:

| Metric | Before | After |
|---|---|---|
| S2 heavy 1–5 strength weeks | 0/10 | **10/10** (heavy variants rotate; S6 with 20% skips: 7/10) |
| S1 biceps sets/week | 0.9 | **3.4** (S2: 5.9 → 11.1) |
| S2 freq-cap breaches | 48 | **0** |
| S2 core sets vs max 18 | 19.2 (100% over) | **16.0** (100% in band) |
| Hamstring / rear-delt mandate firings (S1) | 3 / 0 | **8 / 9** (100% fulfilled) |
| Leg accent conversions (S3) | 0 | **9** across power/eccentric/decel (+10 chest power) |
| S2 volume in band | 46% | **59%** (S3 stays 100%; all safety gates still 0 violations) |
| Capacity warning | — | plan-screen banner when weekly capacity < Σ minimums (bands untouched) |

Design notes discovered during verification:
- The weighted-only legs rule (Sam's design: bodyweight/tendon leg work no longer
  resets the 72h legs clock) was necessary but not sufficient — two more pieces
  were required: a **date-aware** weekly-strength tracker (sessions generate in
  pass order, not calendar order, so a boolean "strength planned" let a planned
  Saturday heavy day get killed by weighted Tue/Thu accents that ran first), and
  a **lunch legs-withhold** while the week's heavy session is unbanked (with
  weighted hinge work at lunch every ~72h, legs were literally never rested on
  any evening).
- Deliberate trade-off: S2 legs volume fell 9.0 → 5.6 sets/week — one guaranteed
  heavy session plus hamstring/hinge lunch work, instead of daily tendon-work
  top-ups. Matches the stated leg goal (strength/resilience, no hypertrophy focus).
- Residual (pool depth, Sam's call): S2 expresses no upper-body power accents —
  both shoulders power movements are avoid-listed and chest always anchors slot 0.
  The accent-softening tier degrades those slots to plain compounds instead of
  dropping them. Adding 1–2 back-safe explosive movements would activate it.

## What's next

Findings with code hooks and candidate tunes are in `analysis/FINDINGS.md`.
Re-run after any tune: `node analysis/case-study.js` (sanity gates included).
S7 (real exported state) runs automatically once `analysis/data/wp3.json` exists —
export from the live site's DevTools console: `copy(localStorage.getItem('wp3'))`.
