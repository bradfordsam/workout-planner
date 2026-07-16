# Findings — actionable tuning items with code hooks

> **Outcome update (2026-07-16):** all findings below except F-08 have been fixed
> and re-verified with the harness. Per-finding outcomes are marked inline; the
> before/after summary lives in the addendum of `case-study-report.md`.
> Design decisions by Sam: F-03 became a plan-screen warning (bands untouched);
> F-01 was implemented via the weighted-only legs rule (bodyweight leg work no
> longer resets the recovery clock) — plus, discovered during verification, a
> date-aware weekly-strength tracker and a lunch legs-withhold, both required
> to make the guarantee actually fire (details in the report addendum).

Each finding cites simulation evidence (`analysis/case-study-data.json`), the exact
code location to change, and a candidate tune. Apply one at a time, then re-verify
with `node analysis/case-study.js` and check the named metric. Line numbers are for
index.html as of 2026-07-15 — re-locate by the quoted identifier if the file has
moved.

---

### F-01 · CRITICAL · Heavy 1–5 leg strength is never programmed when lunch sessions exist
- **Outcome:** **FIXED** — weighted-only legs recovery counting (countsForRecovery* helpers), date-aware strengthDates tracker, evening anchor promotion, and lunch legs-withhold while unbanked. S2: 0/10 → **10/10 strength weeks**, all mandate slots fulfilled, heavy variants rotate (trap bar/heavy RDL). Trade-off: S2 legs volume 9.0 → 5.6 sets/wk — quality over volume, matching the no-hypertrophy leg goal.
- **Evidence:** `heavyStrengthWeeks 0/10` in S1, S2, S4, S5, S6 and S2t; `strength`
  mandate slots fired 0 times outside S3. All evening leg volume arrived via the
  untagged backfill pass (`bottom_half_atg`, `atg_squat_thrust`).
- **Mechanism:** the lunch hinge mandate re-trains legs every ~72h, so legs never
  accumulate enough hours-of-debt to win an evening template slot in the
  `byDebt` race (`dayTemplate`, index.html:1387–1404). The evening `strength`
  mandate (index.html:1417) only tags a leg slot that already exists.
- **Code hook:** `dayTemplate` slot construction (index.html:1391–1419);
  evening-pass slot assembly in `genProgram` (Pass 2/3, index.html:1658–1672).
- **Candidate tune:** guarantee one `strength`-tagged legs slot per week on the
  first evening session where legs are rested (a weekly mandate like the forced
  core slot), independent of the debt race; or, on days with an evening session,
  withhold legs from that day's lunch template so legs debt matures for the evening.
- **Re-verify:** S2 `goal.heavyStrengthWeeks` ≥ 9/10; `mandates.strength.slots` > 0
  with 100% fulfilled; legs lockout violations still 0.

### F-02 · CRITICAL · Biceps pool has zero compound movements → first biceps slot always drops
- **Outcome:** **FIXED** — pickEx tiers 2.5/3.5 (type relax before/after cap relax). S1 biceps 0.9 → 3.4 sets/wk; S2 biceps 5.9 → 11.1; no more phantom "· Biceps" days.
- **Evidence:** biceps mean 0.9 sets/week in S1 (band 6–16, 100% under; trained 4
  days out of 70); day names advertise "· Biceps" with no biceps exercise in the
  session. Pool dump: 4 biceps movements, all `type:'isolation'`.
- **Mechanism:** a muscle's first appearance in `slots` is `type:'compound'`
  (index.html:1406) and `pickEx` requires `e.type===slot.type` with no
  compound→isolation relaxation for non-core slots (index.html:1184–1256) — so a
  biceps compound slot is a guaranteed drop at every gym, silently backfilled with
  another muscle.
- **Code hook:** EX pool (add biceps compounds, e.g. chin-up/underhand row variants
  with `muscle:'biceps'`), or a type-relaxation fallback tier in `pickEx`
  (index.html:1224 area), or special-case slot typing in `dayTemplate`
  (index.html:1406) for muscles whose pool has no compound.
- **Candidate tune:** add a `pickEx` tier after the cap-relax tier: if the slot is
  `compound` and the muscle's pool has no equipment-eligible compound, retry as
  `isolation` before returning null. Smallest blast radius; fixes triceps thinness
  too (see F-06).
- **Re-verify:** S1 biceps mean > 3 sets/week; no session named "· Biceps" without
  biceps work (spot-check `--smoke`).

### F-03 · HIGH · Default availability cannot reach the MRV minimums it is scored against
- **Outcome:** **FIXED (warn-only, per Sam)** — weeklySetCapacity() + plan-screen banner when capacity < Σ minimums; bands untouched. Banner: lunch-only yes, full/3-day no.
- **Evidence:** S1 in-band 14% of muscle-weeks; every muscle except core 100% under
  minimum (legs 5.4 vs min 14, back 6.3 vs 12, chest 5.0 vs 10...). Capacity math:
  5 lunch sessions × 7 sets = ~35 sets/week vs ~64 sets of summed minimums. Even
  S2 (8 sessions/week) leaves legs (9.0 vs 14) and back (9.9 vs 12) 100% under.
- **Mechanism:** `getMRVLimits` (index.html:1859) only rescales bands at exactly 3
  training days (`isEfficiencyMode`, index.html:1857). Schedules of 4–7 low-volume
  lunch sessions keep full hypertrophy bands they can never fill, so the dashboard
  reads permanently "yellow" and the `under` tier dominates every debt race.
- **Code hook:** `getMRVLimits` / `isEfficiencyMode` (index.html:1857–1883);
  weekly set capacity is computable from availability (`EX_LIMIT` index.html:867,
  lunch 3+2+2 rule index.html:1619–1623).
- **Candidate tune:** scale bands continuously by projected weekly set capacity
  (e.g. `min(band.min, capacityShare(m))`) instead of the 3-day cliff; at minimum,
  surface a plan-screen warning when capacity < Σ band minimums.
- **Re-verify:** S1 headline in-band % rises well above 14% without S3 regressing
  from 100%.

### F-04 · HIGH · Forced core slot overshoots core MRV on full schedules
- **Outcome:** **FIXED** — core slot skipped once weekly headroom is spent. S2 core 19.2 (100% over) → 16.0 (100% in band); core still in 70/80 sessions.
- **Evidence:** S2/S2t core 19.2 sets/week vs max 18 — 100% of steady-state weeks
  over the ceiling; every one of 80 sessions contained core work.
- **Mechanism:** `dayTemplate` force-appends the core slot to every session
  (index.html:1482) and the any-core fallback's final tier ignores `fitsMRV`
  (index.html:1252, the `|| leastUsed(allExercises.filter(anyCore))` arm), so core
  is the only muscle that can exceed its weekly max by construction.
- **Code hook:** index.html:1482 (skip appending when `budget.vol.core >=
  budget.limits.core.max`) or index.html:1252 (drop the MRV-ignoring arm).
- **Candidate tune:** skip the forced core slot once weekly core volume has reached
  the band max — the freed slot flows to under-min muscles via backfill, which also
  chips at F-03.
- **Re-verify:** S2 core overPct → 0 while `sessionsWithCore` stays high (≥ 5/week);
  legs/back means tick up.

### F-05 · MEDIUM · Hamstring and rear-delt mandates almost never fire
- **Outcome:** **FIXED** — first-slot tag rotation by day-of-month parity (hamstring flips slot to isolation; rear_delt likewise, opposite parity). S1: hamstring 8, rear_delt 9 firings/10wk (was 3 and 0), 100% fulfilled.
- **Evidence:** `hamstring` slots: 0 in S2 across 80 sessions (3 in S1);
  `rear_delt` slots: **0 across all 490 simulated sessions** in 7 scenarios.
- **Mechanism:** both mandates only tag a *second* leg/back slot in the same
  session (index.html:1418, 1434), but with 2–3 muscle slots per session and up to
  3 muscles in `top`, a muscle almost never appears twice — so the coverage these
  mandates exist to guarantee (knee flexion, scapular/rear-delt health) is left to
  chance.
- **Code hook:** `dayTemplate` leg/back mandates (index.html:1415–1435).
- **Candidate tune:** rotate the single slot's tag instead of requiring a second
  slot — lunch legs alternate `hinge`/`hamstring` by day-of-month parity; back
  alternates `horizontal`/`rear_delt` the same way (mirrors the existing core-cycle
  pattern at index.html:1474).
- **Re-verify:** S1/S2 `mandates.hamstring.slots` and `mandates.rear_delt.slots`
  > 0 with ~weekly cadence; horizontal row coverage stays ≥ 1×/week.

### F-06 · MEDIUM · Frequency cap silently collapses for thin pools (tricep_dips syndrome)
- **Outcome:** **FIXED** — same tiers as F-02. capViolations: S2 48 → 0; tricep_dips no longer pinned.
- **Evidence:** `tricep_dips` picked 31× in S2's 10 weeks (~3.1/week vs the
  2-per-week cap); 48 rolling-window cap breaches in S2, 16 in S6. Triceps pool has
  exactly one compound.
- **Mechanism:** `pickEx` tier 3 deliberately relaxes `FREQ_CAP` rather than drop
  the slot (index.html:1222–1224); with a 1-movement compound pool the "rotation"
  is a fixed point.
- **Code hook:** pool depth (EX array — add compound triceps/biceps options that
  pass the YMCA equipment set), and/or relax `type` before relaxing frequency in
  `pickEx` (combines with F-02's fallback tier).
- **Candidate tune:** implement F-02's type-relaxation tier *before* the cap-relax
  tier, so a fresh isolation movement beats a third weekly repeat of the same
  compound.
- **Re-verify:** S2 `variety.capViolations` < 10; top-pick count ≤ ~2×/week.

### F-07 · MEDIUM · Leg accent rotation (power/eccentric/decel) is dead code at ≤60-min sessions
- **Outcome:** **FIXED (mechanism), residual pool gap** — leg accents ride the post-strength rotation (S3: 9 leg accents across power/ecc/decel + 10 chest power); compound fallback + accent-softening tier added (empty pool degrades to plain compound instead of dropping the slot). Residual: S2 expresses no upper accents because both shoulders power moves are on the avoid list and chest always anchors — a pool-depth limit; adding 1–2 back-safe explosive movements (Sam's call) would light it up.
- **Evidence:** 0 accent conversions across all 490 sessions in 7 scenarios;
  `legAccentDist` all zeros. Only the `powerPreferred` core fallback produced
  explosive work (med ball slams/throws).
- **Mechanism:** the accent converts an *untagged isolation* slot
  (index.html:1454–1461), but sessions of 40–60 min have `muscleSlots ≤ 3` filled
  by first-appearance compounds — an isolation slot only exists when a muscle
  repeats, which effectively never happens. Sam's eccentric/decel goal is
  unprogrammed outside sprint finishers.
- **Code hook:** accent conversion loop (index.html:1446–1461).
- **Candidate tune:** when no isolation slot exists, allow converting the *last*
  compound fill slot (never a mandate-tagged one) on evenings; keep the core
  powerPreferred fallback as-is.
- **Re-verify:** S2/S3 `rotation.legAccentDist` roughly uniform and > 0; strength/
  hinge/horizontal mandate fulfillment unchanged at 100%.

### F-08 · LOW · Session names advertise muscles that get no slot
- **Outcome:** **NOT FIXED** (cosmetic; still open) — day names can still advertise a muscle that got no slot.
- **Evidence:** lunch day named "Legs · Back · Chest" containing no chest work;
  "· Biceps" days with no biceps (also F-02). `muscleSlots = limit-1 = 2` at lunch
  but the name is built from all of `top` (up to 3 muscles).
- **Code hook:** `dayTemplate` return (index.html:1483–1484) — build `names` from
  the muscles actually present in `slots`, not from `top`.
- **Candidate tune:** `const names=[...new Set(slots.filter(s=>s.muscle!=='core').map(s=>MNAME[s.muscle]))]`.
- **Re-verify:** `--smoke` output: every named muscle appears in the exercise list.

---

## Confirmed working as designed (no action)

- **Recovery spacing:** 0 lockout violations in 490 sessions across 7 scenarios;
  min gaps ride exactly on the 72/48/24h limits. The core scheduling promise holds.
- **Safety rails:** 0 hip-risk, plyometric, avoid-list, or lunch high-sweat picks;
  lunch set rule 100%; leg emphasis-tag allowlist never breached.
- **Core 5-tag cycle:** perfectly uniform (10/10/10/10/10 in S1).
- **Sleep shield:** S5 output bit-identical to S1 — fully neutralizes the fatigue
  clamp as documented.
- **Disruption recovery:** 20% skipped sessions (S6) → no violations, graceful
  volume decay, partial in-band recovery.
- **LOG_KEEP=60 retention:** S2t identical to S2 — the 10→60 fix fully closed the
  truncation gap; no generation input looks back further than 7 days.

## Suggested order of application

F-02 (type-relax tier — also fixes F-06) → F-04 (core cap) → F-05 (rotating
mandates) → F-01 (weekly strength guarantee) → F-07 (accent fallback) → F-03
(band scaling — biggest design decision, benefits from re-measuring after the
others) → F-08 (cosmetic).
