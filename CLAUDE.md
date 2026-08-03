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
  hands, never end-range). Also `ezbar_upright_row` + `bench` (2026-08-03, left
  shoulder — see the training-constraints section).
- `shoulderRisk` flag + `S.cfg.shoulderCaution` (2026-08-03) is the shoulder
  twin of `hipRisk`/`hipCaution`, gated in the SAME two places (pickEx's
  `baseFor` and `dayTemplate`'s `canPlaceFoundation` — they must stay in sync or
  the template offers what pickEx will refuse). Reserved for BALLISTIC anterior
  loading that no cue can make safe: `med_ball_chest_pass`, `plyo_pushup`,
  `ezbar_upright_row`. Strength lifts are handled with a ROM cue instead, and
  `tricep_dips` deliberately carries NO flag (it is the triceps pool's only
  compound; the 90° depth cap is what keeps it safe). `shoulderCaution` is
  seeded on via a one-time `S.cfg.shoulderSeeded` marker — a plain
  `===undefined` check can't fire (the toggle has shipped as `false` for
  months) and an unguarded assignment would make the plan-screen checkbox
  impossible to turn off.
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
  Tally lives in `S.century`, cloud-synced via its OWN merge (`mergeCentury`,
  2026-08-03) rather than `SINGLETON_FIELDS`: the draft carries a `touchedAt`
  stamp bumped by the add-set/undo-set handlers only, and the newer-touched
  draft wins whole. `SINGLETON_FIELDS`' per-field stamps move on any `save()`
  (every completed set of squats saves), which is far too coarse, and
  `unionById` can't help because the sets are anonymous rep counts. **Do not
  "simplify" this to longest-draft-wins** — tried, and it breaks undo on a
  SINGLE device: tap a set, undo the typo 90s later, and `saveToCloud`'s
  read-merge (60s throttle, so it re-reads) restores the set from the cloud
  before the undo is ever written. A rule that can't express deletion cannot
  merge a list with an undo button. Two guards on top of the stamp: `startedAt`
  takes the EARLIEST of the two copies (the first set may have been tapped on
  the other phone, and `centuryMins()` measures the whole session), and a
  century already logged today kills the draft on both sides — otherwise
  finishing on phone A (which nulls `S.century`) leaves phone B's draft as the
  only stamped copy and RESURRECTS the session just logged. Both call sites run
  AFTER the log union, since that guard reads `S.logs`. Logged as `isCardio:true` + `century:true` — the same
  "invisible to session bookkeeping" flag the VO2 log uses, so it never marks a
  day completed, never locks that day's lifting template to itself, and never
  eats a lifting slot — but its `exercises` array IS populated, so it counts
  toward weekly MRV **at half weight** in `getWeeklySetVolumes` AND
  `getMRVBreakdown` (submaximal sets don't cost what hard sets cost; at face
  value 100 reps ate the whole week's back MRV and crowded out the mandated
  row/rear-delt work). Weighted pull-ups avoid Century days before Wed.
- `SECONDARY_CREDIT_RULES` / `creditVolume` / `exFull` (2026-08-03): a set
  counts toward the muscles it trains INDIRECTLY, at an evidence-derived
  fraction — pulls → biceps 0.5, chest compounds → triceps 0.5 + shoulders
  0.33, seated overhead press → triceps 0.5, dips → chest 0.5. Rules key on
  `muscle`+`type`, never on id lists, which is what correctly excludes
  straight-arm pulldowns, pullovers, flyes, shrugs and face pulls (all
  `isolation`, no elbow/secondary loading). **Read the derivation comment before
  changing a number**: raw EMG %MVIC is deliberately NOT used (it doesn't
  predict hypertrophy — Vigotsky et al. 2018); the fraction is a RATIO of the
  secondary muscle's activation in the compound to its activation in the
  isolation lift for that muscle, then rounded to a coarse bucket because the
  data doesn't support more precision. `creditVolume` is the ONE booking
  function — every `budget.vol` / `volumes` write goes through it, INCLUDING
  the lunch time-box's set refund, which must hand back the secondary credit
  too or phantom biceps volume accumulates. Log entries carry `muscle` but not
  `type`, so callers holding a log must re-hydrate through `exFull` first.
  Measured effect (6 sim weeks, daily replan, lunch+3-evening): biceps 11 → 16,
  triceps 8 → 12–14, legs 15/11/12/12/14 → 18 every week (40% → 100% in band),
  because the generator stops spending slots on curls it no longer thinks are
  needed. It also closed the documented `pistol_squat` gap on efficiency weeks
  (0% → 100%).
- `LUNCH_LEDGER` / `lunchBudget` / `lunchExMins` (2026-08-03): the 40-min lunch
  is a real ledger — box − spine − century − lifts, and a finisher only if what
  remains covers it. It replaced a flat "3 exercises, minus some on a century
  day" that charged for the lifting and the century and nothing else, so the
  ~5 min of `DAILY_SPINE_MINIMUMS` and the finisher's own declared `mins` were
  both invisible. Reported symptom: a lunch that ran 43 minutes for the workout,
  the spine work and 26 pull-ups, with no finisher at all. Consequences worth
  knowing: **a 40-min lunch never has room for a finisher** (lifting fills
  first; `finisherHTML` returns '' rather than showing one it can't afford), and
  **a century lunch drops from 2 lifts to 1**.
  Two rules guard the finisher, both from a bug found by driving the DEPLOYED
  build rather than the sim: **never on a century day** (100 pull-ups already is
  the conditioning) and **only with a ≥2 min margin left over**. `left` is a
  FLOORING REMAINDER, not free time — a 1-lift century day banked the 8 unspent
  minutes of the lift that didn't fit and bought a finisher with them, so the
  tightest day of the week was the one getting extra work while an ordinary
  3-lift lunch (2 min spare) got none. It was also day-dependent, since
  `getFinisher` rotates by dow: an 8-min circuit slipped through where a 10-min
  one didn't. **Any check on the finisher must sweep every dow on every
  profile** — testing one day proves nothing. `lunchExMins()` calibrates
  minutes-per-exercise from Sam's own logs — only `measured` ones (finishWorkout
  now records whether `duration` was a clock reading or a recovered estimate)
  and only century-free lunches, since a century day has two unknowns in one
  number. `weeklySetCapacity` reads lift counts from the same `lunchBudget`
  rather than re-deriving them; they were maintained separately before and drifted.
- Century pacing (`centurySetPlan`, 2026-08-03): the card used to say "rest as
  long as you need", which is right for a standalone century and wrong for one
  inside a lunch. It now prescribes **sets of ~half your best unbroken set,
  75s rest** — at half max every set is many reps clear of failure, so the
  2–3 min rest figure doesn't apply (that literature is about sets taken NEAR
  failure, which this protocol exists to avoid). Self-scaling like the fixed
  100-rep target: as `best` climbs the sets grow and the session shortens.
  `centuryDefaultMins()` now derives the reserved lunch minutes from that plan
  (16 at the opening prescription) instead of a round 20. **`centuryMins()`
  must never let a PARTIAL century shrink the budget** — the card deliberately
  offers "log N reps & stop here", and 26 reps in 18 min is evidence a century
  is SLOWER than assumed; taken at face value it would have read as "centuries
  take 18 min" and handed the lunch more lifting on the day it already overran.
  Completed sessions calibrate directly; partials are extrapolated pro-rata,
  floored at the default and capped at `CENTURY_MAX_BUDGET_MINS`.
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
- ~~On a 3-evening (efficiency-mode) week, `pistol_squat` is uncovered~~ —
  FIXED as a side effect of secondary-credit (2026-08-03), 0% → 100% of weeks.

## Third pass (2026-08-03) — secondary credit + the lunch ledger

Method changed: the harness now **re-plans every simulated day**, the way the
live app does after each `finishWorkout`. The old once-per-week harness planned
Monday and logged the whole week against zero history, which books three
centuries the generator never budgeted for — it reports back and biceps over
MRV max that the app never actually produces. Measure with the daily-replan
harness and take a BASELINE from `git show HEAD:index.html` through the same
harness; several "regressions" on first run were pre-existing.

Measured, 6 weeks × 3 schedules, baseline → now:
- **lunch+3 evenings** (the main schedule): legs 40% → **100% in band**,
  biceps 11 → 16, triceps 8 → 12–14, chest 10–12 → 10–13. Every mandate and
  every Foundation movement stayed at 100%.
- **3 evenings only**: `pistol_squat` 0% → 100%, chest 6 → 8, shoulders 3 → 5–8,
  biceps 6 → 8–9, legs 6 → 9. `weighted_pullups` still 0% and back still 9
  (both pre-existing).
- **lunch-only**: biceps 2 → 8–10 (0% → 100% in band), triceps 2–3 → 5–7,
  chest 3 → 4–7. Mandate rates unchanged.

Accepted cost, measured not assumed:
- **Core on lunch-only weeks: 10–11 → 4 sets.** A century lunch is now 1 lift,
  and `tmpl.slots.slice(0,limit)` at limit=1 takes the muscle slot and drops the
  reserved core slot. Accepted because (a) the plank in `DAILY_SPINE_MINIMUMS`
  is done all 7 days and is never booked as core sets anyway, and (b) the
  alternative is spending a century lunch's only lift on core. Do NOT "fix" this
  by reordering the core slot ahead of the muscle slot — read the TRIED AND
  REVERTED block on the core slot first.
- lunch-only still under-fills nearly every band. Unchanged, still by design.

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
- Left shoulder (2026-08-03): **upright rows hurt, and the front of the
  shoulder hurts while benching.** Origin: something popped on a maximal
  baseball swing a few years ago. Both provocative lifts share one mechanism —
  the humeral head loaded at an end range it can't control — so the exclusion
  generalised past the two named lifts rather than stopping at them:
  `ezbar_upright_row` (abduction + internal rotation, the textbook impingement
  position) and `bench` (fixed hands, so the arms can't pick their own path and
  the bottom position isn't negotiable) both go on `avoidExercises`. Pressing
  is NOT banned as a class — `floor_press` now LEADS the chest compound block
  (the floor is a mechanical stop that enforces the ROM limit when a cue would
  be ignored under fatigue), the DB/machine variants carry a "SHOULDER STOP:
  stop at the torso line" cue, and the fly family lost its "full stretch at the
  bottom" cueing for the same reason. Don't add new pressing that fixes the
  hands to one bar or cues a deep bottom stretch. **This has never been
  assessed** — the pattern (a pop under a violent swing, still symptomatic
  years later on two specific loaded positions) is worth a physio's opinion,
  and the app changes are load management, not treatment.
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
