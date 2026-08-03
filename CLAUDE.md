# Workout Planner

Single-file PWA: all app code lives in `index.html` (one `<script>` block).
`sw.js` / `manifest.json` are PWA boilerplate. No npm, no build step, no
framework. Deployed via GitHub Pages — **pushing to `main` IS deploying to
production** (Sam uses the live site daily, including mid-workout).

## Deploy workflow (every change)

Run these gates in order; stop and report at the first failure.

1. **Verify** — no build/tsc/lint here; the gate is a syntax check of the
   script block:
   ```
   node -e "const html=require('fs').readFileSync('index.html','utf8'); [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{try{new Function(m[1]);console.log(i,'OK')}catch(e){console.log(i,'ERR',e.message);process.exitCode=1}})"
   ```
   **Node is NOT installed on this machine** (and `python` is only the Store
   stub) — that command and `analysis/case-study.js` can't run here. Fallback
   that works and is strictly stronger, using installed Chrome: build a harness
   page that inlines the script block (sliced at the `// INIT` sentinel, same as
   the case-study harness) behind a `SimDate` clock shim, drive it with a test
   script that writes results into a `<pre>`, and read them back with
   `chrome.exe --headless=new --dump-dom` (via `Start-Process
   -RedirectStandardOutput`, since PowerShell 5.1 mangles native stderr). This
   parses AND executes the real generator, so it catches "the mandate never
   fires" bugs a syntax check can't. Assert coverage over several simulated
   weeks under BOTH a lunch-only and a lunch+evening availability profile —
   every foundation/mandate bug so far only showed up in one of the two.
2. **Git preflight** — this repo belongs to the PERSONAL account:
   - Remote: `https://github.com/bradfordsam/workout-planner`
   - `gh auth status` must show **bradfordsam** active (NOT the work account
     sam-bradford-eng). If not: `gh auth switch --user bradfordsam`.
   - `git status` — confirm only intended files are staged.
3. **Sync** — the user edits from multiple machines/sessions; if push is
   rejected, `git pull --no-rebase`, resolve (conflicts are usually both
   sides appending to the same pool array — keep both), re-run gate 1 on the
   merged result.
4. **Push to `main`** — that's the deploy. GitHub Pages serves it within a
   couple of minutes.

Config-file hygiene: if a JSON config (settings.json etc.) fails to parse,
check for a UTF-8 BOM first (PowerShell's default encoding adds one) and
strip it before other debugging.

## Architecture notes

- Exercise pool: `EX` array (~line 250+), objects with
  `id/name/muscle/type/eq/rMin/rMax/rest/cue/tags`.
  **EX ORDER IS LOAD-BEARING for thinly-populated slots.** `pickEx`'s
  `leastUsed()` breaks frequency ties by array order, and the rolling 7-day
  frequency window decays to zero between slots that only fire once or twice a
  week — so such a slot is winner-take-all and the FIRST matching movement is
  the only one that ever gets programmed. Adding a movement lower in that
  block is adding dead code (proven 2026-08-03: `inverted_row` listed fourth
  among 'horizontal' took 0 picks across 6 simulated weeks on BOTH availability
  profiles; leading the block it lands every week that hosts the slot, with
  `bb_row` demoted to the second slot rather than displaced). When adding to a
  low-frequency slot family, decide the intended default and order accordingly
  — then SIMULATE, because a never-picked entry looks identical to a working
  one in a syntax check.
- Scheduling: per-day recovery-debt engine (`dayTemplate`), 6 muscle groups +
  a forced core slot. Mandates: first evening leg slot = 'strength' (heavy
  1–5 pool, falls back to 'hinge' when no barbell/DB), lunch leg slot =
  'hinge', second leg slot = 'hamstring'; back gets horizontal/rear-delt.
  Leg accent slot rotates power/eccentric/decel by day-of-month; the core
  slot cycles anti-rotation/rotation/flexion/anti-extension/lateral.
  **Day-of-month rotations can ALIAS with a muscle's training cadence.** The
  back accent used `domDay%2`, but recovery brings back around every ~2 days,
  so every back day in a week shared one parity: the flip stopped alternating
  within a week and alternated between weeks instead, all-or-nothing. Measured
  2026-08-03 over 6 simulated weeks — 3 of 5 steady weeks logged ZERO horizontal
  rows and the others logged no direct rear-delt work. Fixed by rotating on
  `Math.floor(domDay/2)%2` so the counter advances at the rate back actually
  recurs (2/5 → 5/5 weeks with a row). Before adding or editing a `domDay%N`
  rotation, check N against how often that muscle is actually trained — and
  measure the LANDED outcome per week, not the pick counts, which are inflated
  by discarded replans.
- Conditioning: `CONDITIONING_FINISHERS` (sprint-centric; `sprint:true`
  renders `SPRINT_PRIMER`, `lunchOK` marks the low-sweat subset lunch draws
  from) and `VO2_PROTOCOLS` (4-protocol engine rotation incl. Zone 2 and
  off-feet anaerobic repeats).
- Personal exclusions: `S.cfg.avoidExercises` id blacklist (movements that
  flare a specific issue). Seed new ones in BOTH the default cfg and a `load()`
  migration. Current list includes `plank_outside_climbers` (2026-08-03) — the
  outside foot-step is deep flexion + abduction, i.e. the FAI impingement
  position, and it carries neither a `plyometric` tag nor `hipRisk`, so nothing
  else would have caught it. `mountain_climbers` stays (knees drive inside the
  hands, never end-range).
- `'own_gear'` (2026-08-03) is a PSEUDO-equipment token on `EQUIPMENT_PRESETS`
  meaning "Sam's own kit is on hand" — currently the weighted vest. Carried by
  apartment_gym / westminster_gym / bodyweight / moms_and_dads, withheld from
  ymca and hotel_gym, because the vest doesn't travel to a public gym. So
  `pushups_w` is `eq:['own_gear']` and the ORDINARY equipment gate filters it
  everywhere at once (normal pickEx tiers, the Foundation short-circuit, the
  backfill, the swap list) with no special case. Note `pickEx` does
  `new Set([...equip,'bodyweight'])`, so 'bodyweight' is granted unconditionally
  and could never express this — hence a distinct token. Consequence: an
  all-YMCA week cannot cover the push-up Foundation movement; `fundamentalsHTML`
  says so in words (same precedent as bear crawl on a lunch-only week).
- `SETUP` map + `setupFor`/`SETUP_ROW` (near `HANDLES`): "what do I do this ON"
  notes (bar height, rig). Separate from `HANDLES` because the Attachment row is
  gated on the gym having `cables` — a rack note in `HANDLES` would be hidden at
  Westminster and Mom and Dad's, neither of which has a stack.
- Stretch pools (`HIP_POOL`, `SHOULDER_POOL`, `LOWER/UPPER_MOBILITY_POOL`,
  `COOLDOWN_POOL`) live inline in the workout render fn and rotate by date.
- `DAILY_SPINE_MINIMUMS` (global, near `recoveryHTML`): four FIXED daily poses
  (child's pose knees-wide 60s / cobra 2min / plank 60s / down dog 60s) shown
  every day — rest card, today card, and evening cool-down (with hold timers).
  Dashboard version omits hold buttons (`startRest` needs `S.active`).
- `FOUNDATION_FIVE` (2026-07-28): weighted pull-ups / push-ups / single-leg
  squat / bear crawl / plank get a WEEKLY COVERAGE GUARANTEE instead of
  competing for slots on merit. `dayTemplate` stamps at most ONE uncovered
  movement per session as `slot.foundationId`; pickEx's first tier returns that
  exact movement, bypassing type/tag/legAutoOK and the MRV/frequency caps but
  NOT the safety gates (equipment, avoid list, hip/knee caution, lunch sweat).
  The plank is `daily:true` — already covered by `DAILY_SPINE_MINIMUMS`, never
  slot-scheduled. Three non-obvious invariants, all found by simulation:
  1. Coverage is seeded from LOGS ONLY (`foundationCoveredThisWeek`), never
     extended by planned sessions. Every day re-plans the week, so a stamp on a
     future session usually evaporates before that day arrives — marking
     planned sessions as covered spent the stamp on templates that were then
     discarded, and push-ups landed 0 weeks of 6.
  2. The stamp is part of `tk`. Without it a stamped day matches the previous
     plan and takes the preserve-don't-rebuild path, so coverage can never land.
  3. `slot.tag==='strength'` is NEVER overridden (heavy-leg guarantee wins).
     `hinge`/`hamstring` are protected Mon–Tue only; from Wed on the late-week
     escape valve lets an uncovered movement take them, else a leg slot ALWAYS
     carries a mandate tag and pistol squats land 0 weeks of 6.
  Coverage measured over 6 simulated weeks: 4/4 movements every week on a
  lunch+evening schedule; 3/4 lunch-only (bear crawl is `highSweat`, so it is
  structurally unplaceable in a no-shower lunch — `fundamentalsHTML` says so
  explicitly instead of showing a permanent red dot).
- `PULLUP_CENTURY` (2026-07-28): 100 pull-ups/session, any number of sets, on
  `centuryDows()` (up to 3 available training days, ≥48h apart, derived from
  AVAILABILITY not the program — `dayTemplate` reads it, so program-derived
  would be circular). **A YMCA lunch IS eligible** (2026-08-03) — it just costs
  time, so the cost is charged rather than ignored: `S.century.startedAt` is
  stamped on the FIRST set (not at render — the card sits on the dashboard all
  day), the finish handler writes MEASURED `timedMins` to the log, and
  `centuryMins()` returns the median of the last 5 timed sessions (default 20).
  `buildSession` then cuts a century lunch's exercise limit to
  `floor((40 − centuryMins)/10)`, ~2 lifts at the default. The rate is 10
  min/exercise, not the 40÷3 ≈ 13 the whole box implies, because the century
  absorbs the warm-up. `timedMins` is stored SEPARATELY from `duration` so the
  old set-count estimate can never feed back into scheduling as if it were a
  measurement. Target is fixed; the SET COUNT is the progress metric.
  Tally lives in `S.century` (localStorage only, not a `SINGLETON_FIELDS`
  cloud-synced field). Logged as `isCardio:true` + `century:true` — the same
  "invisible to session bookkeeping" flag the VO2 log uses, so it never marks a
  day completed, never locks that day's lifting template to itself, and never
  eats a lifting slot — but its `exercises` array IS populated, so it counts
  toward weekly MRV **at half weight** in `getWeeklySetVolumes` AND
  `getMRVBreakdown` (submaximal sets don't cost what hard sets cost; at face
  value 100 reps ate the whole week's back MRV and crowded out the mandated
  row/rear-delt work). Weighted pull-ups avoid Century days before Wed.
- `fundamentalHabits()` / `fundamentalsHTML()`: the Foundation Five coverage
  card plus the daily habits list — protein at target bodyweight, sleep,
  walking, caffeine+alcohol timing (fibre/satiety and the 80%-week rule were
  dropped 2026-07-28 as too obvious to earn dashboard space; the
  consistency argument still lives in the closing "subtraction" callout).
  Explicitly NO biohacks — no supplement stack, fasting window, cold plunge, or
  readiness score. Keep it that way; the point is habits that survive a
  workday. The card's "N habits" line is DERIVED from the array length — a
  hardcoded count went stale the first time the list was edited.

## Balance audit (2026-08-03, 8 sim weeks × 4 schedules)

Harness measures every muscle against its MRV band plus every mandate as "% of
steady weeks satisfied". Re-run it before touching `dayTemplate` — several of
these interact.

Fixed in that pass:
- **Wasted Foundation stamps.** Only ONE movement is stamped per session, so
  stamping something `pickEx` will then reject burns the whole session's
  coverage budget. `dayTemplate` now runs `canPlaceFoundation` (equipment,
  avoid list, hip/knee, plyo, lunch-sweat) — deliberately the same conditions
  as pickEx's foundation gate. Coverage 0% → 100% of weeks on two schedules.
- **The `domDay%2` aliasing again, in the LUNCH LEG mandate** — same bug as the
  back accent, same fix (`floor(domDay/2)%2`). Hamstring 57% → 86%.
- **Back slot 1 takes the COMPLEMENTARY accent**, not always `rear_delt`; when
  slot 0 was already rear_delt the week could never reach a row.
- **Century MRV cost is now FLAT (`CENTURY_MRV_SETS`)**, not `sets × 0.5`. Set
  count is the PROGRESS metric and falls as he improves, so the old costing
  made the identical 100 reps progressively cheaper — 12 sets billed 6, later 4
  sets billed 2.
- **`centuryDows` leaves ≥1 training day century-free.** On a 3-evening week all
  three days were century days, back hit 15 against an efficiency band of 3–10,
  and the MRV gate then blocked ALL rowing/rear-delt work.
- **`centuryDows` prefers Tue/Thu/Sat** — pull-ups are easier for Sam on those
  days (2026-08-03) and the trio satisfies the ≥48h spacing equally. It falls
  back to the calendar walk whenever the preference would yield FEWER days (a
  weekday-only week can't fit a third around Tue/Thu, so it still gets
  Mon/Wed/Fri). Side benefit worth knowing: moving centuries off Mon/Wed/Fri
  freed back slots there — horizontal 57%→86%, rear_delt 43%→71%.

Second pass (same day) — legs were UNDER band on every schedule, and it was
arithmetic, not the scheduler misjudging recovery. Core never competed for those
slots at all (it isn't in `dayTemplate`'s `MUSCLES` list; it holds a reserved
slot via `muscleSlots = limit-1`). Two real causes, both fixed:
- **Legs now carry TWO recovery windows** (`legsRecovered`, `LEG_LIGHT_LOCKOUT`):
  72h after heavy 1–5 @85–95%, but 48h after an accent day, which doesn't need
  three days. `getLockedMuscles` calls the SAME predicate — if the two disagree
  the template makes a leg slot that pickEx then refuses to fill.
- **Depth over breadth**: a 60-min evening is `EX_LIMIT[60]`=4 → `muscleSlots`=3,
  which exactly matched the 3-muscle breadth, so no muscle could EVER take a
  second exercise. Any muscle needing >3 sets/day was unreachable by
  construction. When the anchor is under its weekly minimum it now takes 2 slots
  instead of reaching onto a third muscle. Applies to whichever muscle anchors.
  Legs 8–9 → 14–15 sets (0% → 100% in band); hinge and hamstring → 100%.
  Cost, accepted: chest 12→9 and biceps 9→5 (slightly under band) since total
  slots are conserved — biceps in particular still get 300 pull-ups/week.
- Do NOT defer the second leg slot's 'hamstring' tag the way the back accent is
  deferred. Tried: an untagged leg slot gets captured by the hybrid-athlete
  power-accent conversion, hip caution bans most of that pool, pickEx finds
  nothing and the slot is DROPPED — legs fell straight back to 9. An explicit
  'hamstring' tag also bypasses `legAutoOK`, so the slot always fills.

Known-structural, deliberately NOT "fixed":
- Lunch-only weeks under-fill nearly every band. That gap is surfaced by the
  `weeklySetCapacity` plan-screen warning by design — bands are physiological
  targets and a yellow dashboard on a light week is honest. Don't shrink bands.
- Back accents cap around horizontal 57% / rear_delt 43% on full schedules:
  three claimants (weighted-pull-up guarantee, horizontal, rear_delt) for the
  ~2 back slots/week recovery debt allocates. Exactly one lands each week.
- `pushups_w` uncovered on all-YMCA weeks and `bear_crawl` on lunch-only weeks —
  both are direct consequences of stated constraints (vest doesn't travel; no
  sweating at lunch). `fundamentalsHTML` explains each in words.
- Core sits at the top of its band because its slot is reserved, not won. See the
  TRIED AND REVERTED block on the core slot before attempting the obvious fix.
- On a 3-evening (efficiency-mode) week, `pistol_squat` is uncovered: legs get a
  single slot there and it is always the 'strength' slot, which the Foundation
  stamp never overrides. Fixing it costs the leg volume gain above.

## Training constraints (why the code is shaped this way)

- Left hip has FAI history (`hipCaution`): no HARD-landing/impact plyos, no
  loaded end-range rotation through the hips; `hipRisk` flag + avoid list
  enforce it. Exception (2026-07-22): the low-impact reactive subset is allowed
  under hip caution — exercises flagged `lowImpact:true` (chair & JAPAP jumps,
  pogo/plate/line hops: quiet ankle work or single max efforts, no repeated hard
  landings) pass the plyo ban via the `plyoHidden()` helper. True impact plyos
  (depth jumps, single-leg drops, bounds) stay banned. Any new `plyometric`
  exercise is banned by default unless explicitly given `lowImpact:true`.
  Heavy strength variants are deliberately hip-friendly (box squat depth cap,
  elevated trap bar, staggered stance) so they stay outside the ban.
- Lower back: **any standing overhead press hurts** (2026-07-27, expanded from
  the push-press-only report). `ohp`, `push_press`, `db_push_press`, and
  `thrusters` are all on `avoidExercises`. Seated overhead pressing
  (`seated_db_press`, `arnold_press`) is fine and keeps the shoulders pool
  supplied with a compound. Don't add new standing overhead press variants
  (jerks, standing landmine/Z-press, overhead carries under load).
- Leg training goal (updated 2026-07-14): multi-directional force handling,
  high eccentric loading, and movement resilience — heavy 1–5 @ 85–95% squat/
  hinge/single-leg strength plus eccentric/decel/lateral work; still no
  hypertrophy focus. Sprinting is IN (short/loaded + long/unloaded + decel/COD
  finishers) but always primed first and never at lunch.
- Aerobic engine: VO2 intervals + Zone 2 base + anaerobic repeats; hard
  conditioning beyond sprints goes off-feet (bike/row/ski) to cap impact.
- Consistency-over-optimization (2026-07-28): the program is explicitly built
  around a short list of high-return movements repeated for months (see
  `FOUNDATION_FIVE`, `PULLUP_CENTURY`) rather than novelty or perfection. Two
  design rules follow from it: prescriptions should be self-scaling so they
  never need rewriting as fitness changes (the Century's target never moves —
  the set count does), and the biggest wins come from SUBTRACTION (the avoid
  list, the plyo ban, dropping sessions when a muscle isn't recovered) because
  that's what keeps twelve unbroken weeks possible. Don't add biohack-flavoured
  features (supplement stacks, fasting windows, cold exposure, readiness
  scores) — `fundamentalHabits()` is deliberately limited to interventions with
  real effect sizes that survive a workday.
- Lunch sessions stay low-sweat: `highSweat` exercise filter, `lunchOK`
  finisher filter, 90s rest cap — don't route sprint or interval work there.
- Lunch time-box calibration (2026-07-14, ran ~7 min long): lead lift 3
  working sets, every later exercise 2 sets (enforced at generation AND at
  startWorkout for preserved sessions), warm-up ramp cut to 2 sets at lunch.
