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
   **Node IS installed as of 2026-08-05** (v24; it was not before, and this file
   used to describe a headless-Chrome workaround — that's obsolete, use Node).
   `python` is still only the Store stub, so don't reach for it; use `node` for
   scripted file edits.
   A syntax check is NOT sufficient on its own. Also run:
   - `node analysis/case-study.js` — the committed harness. `--smoke` for a fast
     load check. **`git checkout -- analysis/case-study-data.json
     analysis/case-study-report.md` afterwards** unless the new numbers are
     meant to be committed; a full run rewrites both.
   - A **render smoke test**: load the script block into a `vm` sandbox (slice at
     the `// INIT` sentinel, mock `document`/`localStorage`, shim `Date` with a
     `SimDate`), fabricate an `S.active`, and call `renderWorkout()`,
     `centuryHTML()`, `lunchBudgetHTML()`, `renderDash()`, `renderPlan()`.
     Assert the output contains the strings the change was supposed to add and
     contains no `undefined` / `[object Object]` / `NaN`. **A ReferenceError
     inside a template literal is invisible to the syntax check** and this is
     the only thing that catches it. (`renderReviewWorkout` writes to
     `innerHTML` and always throws in the sandbox — that's expected, not a
     regression.)
   - A **balance sim** whenever `dayTemplate`, MRV pricing, or the lunch ledger
     is touched: re-plan every simulated day the way the live app does after
     `finishWorkout`, log centuries on `centuryDows`, and read volume back out
     of `getWeeklySetVolumes()` so secondary credit and century pricing are
     included exactly as the dashboard sees them. Take a BASELINE from
     `git show HEAD:index.html` through the same harness — several apparent
     regressions turn out to be pre-existing. Measure over BOTH a lunch-only and
     a lunch+evening profile, plus the 3-evening efficiency profile: every
     foundation/mandate bug so far showed up in only one of the three.
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

- Cue presentation (2026-08-05): the "Feel it" line and the collapsible
  "Technique tip" were merged into ONE always-visible bulleted block
  (`cueBlockHTML` / `cueBullets`), per Sam — "bullet points for feel cues rather
  than hard to read paragraphs… compressed into one space". The split is done at
  RENDER time by sentence-splitting `ex.cue`, deliberately **not** by rewriting
  ~175 cue strings into arrays: several encode injury constraints referenced
  from this file, and a formatting change is a bad reason to retype them all.
  The regex requires whitespace after the sentence end (which makes decimals
  safe) and a capital/digit next (which stops abbreviations splitting); stubs
  under 18 chars fold back into the previous bullet. **A missed split gives a
  longer bullet; a wrong split cuts an instruction in half** — swept over every
  cue in `EX` and verified lossless before shipping. Re-run that sweep after
  bulk cue edits.
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
  all-YMCA week cannot cover the push-up Foundation movement. This used to be
  explained in words on the dashboard; that card was removed 2026-08-03, so the
  gap is now SILENT (see the Fundamentals-card note below).
- `SETUP` map + `setupFor`/`SETUP_ROW` (near `HANDLES`): "what do I do this ON"
  notes (bar height, rig). Separate from `HANDLES` because the Attachment row is
  gated on the gym having `cables` — a rack note in `HANDLES` would be hidden at
  Westminster and Mom and Dad's, neither of which has a stack.
- **Pre-lift prep** (`prepPlan` + the pools, 2026-08-05): everything between
  opening a workout and the first working set. Moved OUT of the workout render
  fn to module scope so `lunchBudget` can charge for it. `COOLDOWN_POOL` is
  still inline in the renderer (post-session, nothing budgets against it).
  - **Prep is a BUDGET, not a list.** Blocks are filled round-robin — every block
    gets its first item before any gets a second, so none can be starved — until
    `PREP_BUDGET_MINS` (lunch 6 / evening 12) runs out. `prepPlan` guarantees it
    never exceeds the cap, which is what makes the figure safe for `lunchBudget`
    to reserve without knowing which rotation lands today.
  - **Item durations are PARSED from the description** (`prepItemSecs`): every
    entry already states its own dose ("30 sec/side", "8 reps/side", "15
    swings"), so a new pool entry prices itself. `/side` doubles; "total" (as in
    cobra's "2 min total") suppresses that. `LUNCH_LEDGER.spineMins` is derived
    the same way instead of being a restated constant — both fixed doses are
    **getters** on LUNCH_LEDGER because the pools are declared later in the file
    and a plain property would hit the TDZ at module-eval time.
  - **Leg days differ from desk days.** Every pool entry carries a focus tag
    `f:['hamstring'|'achilles'|'adductor'|'hip'|'spine'|'glute'|'shoulder']`,
    and that tag is the whole mechanism: a leg day gets a `Leg Prep` block
    filtered to the first three, a non-leg day gets hip/spine only (Sam's rule —
    he arrives straight from a desk). **An untagged entry would be invisible to
    both filters** — the same silent-dead-code trap EX ordering has — so
    `prepFocus()` defaults it into the desk pool rather than dropping it.
    `isLegDay` is read off the built session (`exercises.some(muscle==='legs')`),
    never asked of the generator, so swaps and preserved sessions are covered.
  - **`PT_HIP_POOL`** — thirteen movements Sam's physio named. Its own block, not
    scattered through `HIP_POOL`: a 26-entry pool showing 4 a session surfaces
    any one movement about once a fortnight, which is not a rehab dose, and the
    provenance is worth labelling. NOT in `EX`, following the
    `DAILY_SPINE_MINIMUMS`/plank precedent — `hips` isn't in `dayTemplate`'s
    `MUSCLES` so an EX entry there can never be slot-scheduled anyway.
    `band:true` marks the four needing a mini band. **`Kinky Leg Spreads` is a
    guessed interpretation** (seated spread with the torso hinged forward) —
    flagged to Sam, correct it if the physio meant something else.
  - `DESK_REVERSAL` (chin tucks + pelvic tilts) and `HIP_DECOMPRESSION` are
    FIXED blocks — never rotated, never budget-trimmed. Desk reversal now shows
    at lunch too; it used to be evening-only, which had it backwards.
- `MCGILL_BIG3` + `mcgillHTML()` (2026-08-03, Sam asked for it by name): McGill's
  modified curl-up / side bridge / bird dog, rendered in the same three places as
  `DAILY_SPINE_MINIMUMS` (dashboard, rest card, evening cool-down). That pairing
  is the point — the spine minimums are the mobility/decompression side, this is
  the STABILITY side. Doses are ~10s holds with reps DESCENDING 6→4→2, because
  the protocol targets trunk-muscle ENDURANCE, and high-rep/high-load trunk work
  is what aggravates a cranky back rather than sparing it.
  - **NOT folded into `DAILY_SPINE_MINIMUMS`, and NOT charged to
    `LUNCH_LEDGER.spineMins`** — the deciding number, since "it's only 6 minutes"
    is exactly the reasoning the lunch ledger exists to refute: spine 5 → 11 min
    turns an ordinary lunch from `floor((40−5)/11)`=3 lifts into
    `floor((40−11)/11)`=2. A third of his lunch lifting is too much to pay for
    floor work that needs no gym, so the card says morning-or-evening instead.
    **If it ever moves into the lunch box, `spineMins` must move with it.**
  - **NOT in `EX`**, following the plank's precedent in `FOUNDATION_FIVE`: a fixed
    daily dose is a stronger guarantee than a weekly slot, and adding these to the
    core pool would double-program the same three movements.
  - `mcgillHTML(holds)` — the dashboard/rest callers must pass falsy, since
    `start-hold` → `startRest` writes to `S.active`, which is null outside a
    workout. Same trap `dailySpineHTML` already documents.
  - Note the tension it creates with the Pyramid's 400-sit-up rung, which McGill
    would specifically argue against. Flagged in that rung's cue rather than
    silently resolved; Sam's call either way.
- `hip_airplane` (2026-08-03, asked for by name): in `EX` as a `hips`/`mobility`
  entry beside `hip_cars`, and in the rotating pre-lift `HIP_POOL` which is what
  actually delivers hip work (`hips` is NOT one of `dayTemplate`'s `MUSCLES`, so
  hips entries are never slot-scheduled — which is also why adding one carries no
  EX-ordering risk). **Why this doesn't violate the hip rule:** the constraint is
  no *loaded* end-range rotation (why `woodchop` is on `avoidExercises`). This is
  bodyweight and the range is SELF-SELECTED — you only rotate as far as you can
  control and return from, which stops short of the passive end range where a cam
  impinges. `hip_cars` is already in the pool on exactly that reasoning and
  `hip_90_90` deliberately trains internal rotation because impingement restricts
  it. Cued external-rotation-first and further, because IR *in flexion* is the FAI
  provocation position and the hinge already supplies the flexion. Deliberately
  NOT flagged `hipRisk` — that flag would hide it entirely under `hipCaution`,
  which is on; the pinch cue and the self-limited range are the safety mechanism,
  the same way `tricep_dips` relies on its depth cap.
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
  structurally unplaceable in a no-shower lunch; the card that used to say so
  was removed 2026-08-03).
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
  **Timing (2026-08-05, "I forgot to stop my century today")**: `timedMins` is
  measured first set → **LAST SET** (`draft.touchedAt`), never to the Log tap.
  The card sits on the dashboard all day, so the gap before you remember to tap
  is unbounded and was being recorded as though he'd been on the bar for it —
  and that number is the median that reserves lunch minutes, so one bad reading
  visibly costs a day's lifting. This also makes the interactive path agree with
  `flushStaleCentury`, which already measured to `touchedAt`. The log is stamped
  at the last set for the same reason. On top: a `CENTURY_MAX_BUDGET_MINS`
  plausibility prompt (the guard `finishWorkout` has always had and the century
  never did) for a gap BETWEEN sets, which `touchedAt` can't catch; and the time
  is EDITABLE afterwards from the Done card (`centuryTimeEditHTML`) and from Edit
  Workout, where `syncLogEditInputs` keeps `timedMins` in step with the edited
  duration — otherwise a fix would look right in History and change nothing about
  the schedule. **`save-log-edit` also calls `replanCurrentWeek()` now**, which it
  never did (it only recalculated `lastWeights`): editing history changes the same
  inputs finishing a session does — recovery debt, weekly MRV, and via
  `centuryMins` the lunch time-box — so the program was left running on the old
  numbers until some unrelated event triggered a replan. That is general, not
  century-specific; any log edit was affected. **Blank/0 means "untimed", which is a real answer**: `centuryMins`
  filters on `timedMins>0`, so an unknown session is skipped rather than
  poisoning the median with a guess. That is the whole reason `timedMins` is
  separate from `duration`. `centuryDefaultMins()` is now capped at
  `CENTURY_MAX_BUDGET_MINS` too — at a low `best` the derived plan reached 47 min
  and drove the lunch ledger negative.
  **MRV pricing (revised 2026-08-05, `CENTURY_MRV_SETS` 3 → 5, priced by REPS
  via `centuryMrvSets`)** — see the Fourth pass section below for the measured
  effect and the two scheduler changes that had to land with it. A PARTIAL
  century now bills its share rather than the full flat rate; the card
  explicitly offers "log N reps & stop here", so billing 26 reps as 100 would
  suppress the rest of the week's back work on the strength of work that never
  happened. `pyramidMrvSets` derives its rate from `CENTURY_MRV_SETS`, so
  changing it re-prices the ladder by the same factor — that identity (the same
  100 pull-ups cost the same either way) is deliberate, not a side effect.
  **Progression (2026-08-05, Sam asked whether set 1 should be to failure)**:
  no. Reps stay CONSTANT within a session — a set count that falls away means
  set 1 was too close to failure — and progression comes from a SCHEDULED test:
  every `CENTURY_TEST_EVERY`(=4)th century opens with one true max set, and that
  is the only near-failure set in the protocol. Without it nothing ever moved
  `best`, which the whole prescription is sized from — self-scaling with no
  input isn't self-scaling. `centuryStats().best` is a ROLLING window
  (`CENTURY_BEST_WINDOW`=8) so the prescription tracks form in both directions;
  `bestEver` is kept for the trend line only.
  Tally lives in `S.century`, cloud-synced via its OWN merge (`mergeCentury` on
  the shared `mergeStampedDraft`, 2026-08-03) rather than `SINGLETON_FIELDS`: the draft carries a `touchedAt`
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
- `PYRAMID_LADDER` (2026-08-03): Tom Holland's Spider-Man ladder, taken as LOGIC
  not as a fixed prescription (Sam: "I don't have to do this exact workout every
  Monday, it just clearly works"). Climb rungs 1→peak then back down, each
  movement carrying a multiplier. The arithmetic is the whole reason it's a
  feature: up-and-back sums to **peak² reps per unit of multiplier**, so the
  session is (Σ mult) × peak² — at peak 10 with 1/2/3/4/5 that's exactly the
  original 100/200/300/400/500 = 1,500 reps. **ONE number sets the entire dose**,
  which is what makes it obey the self-scaling rule: `pyramidPeak()` derives it
  from `centuryStats().best` minus `PYRAMID_PEAK_HEADROOM`, so the top rung stays
  2 reps clear of failure (the same rule the Century runs on) and the ladder
  never needs rewriting as he improves. No Century history → peak 6 (540 reps).
  **NEVER SCHEDULED BY THE GENERATOR** — `dayTemplate` knows nothing about it. A
  generated session that could be silently swapped would make the recovery-debt
  bookkeeping a lie, and "every Monday" is what Sam explicitly didn't want.
  It IS prescribed on suitable nights, at PRESENTATION level only —
  `pyramidPrescription()` (2026-08-03, Sam's rule: "if I am not working out at
  YMCA or hotel one day and I have a lot of time the ladder is prescribed"):
  - `PYRAMID_EXCLUDED_GYMS=['ymca','hotel_gym']`, a named list rather than a
    "has a barbell" test because the two exclusions have DIFFERENT reasons. The
    YMCA is the only place the heavy 1–5 barbell mandate can happen, so spending
    that evening on bodyweight reps trades the scarce resource for the abundant
    one. `hotel_gym` has no `pullup_bar`, so the ×1 rung — the movement that SETS
    the peak — can't be done at all.
  - `PYRAMID_PRESCRIBE_MINS` is DERIVED as the first rung above the standard
    60-min evening on the `EX_LIMIT` scale (→75), not an invented constant, so it
    still means "more than a normal evening" if that scale ever changes.
  - The evening must also cover `plan.mins + LUNCH_LEDGER.spineMins`. This does
    real work: once a few MEASURED sessions push `pyramidPlan().mins` past ~70,
    a 75-min evening stops qualifying. Prescribing a session that doesn't fit is
    the exact failure the lunch ledger exists to prevent.
  - A ladder missing any rung is offered but never PRESCRIBED — which is why the
    bar-less `bodyweight` (field) preset doesn't get the star even though it
    isn't on the excluded list.
  - Presentation level means: the card renders expanded with a "Tonight's
    session" banner and its reasoning, the evening block gets a note at the
    button he'd otherwise tap, and the planned lifting session stays fully
    available as the alternative. The engine books whichever one gets logged, so
    nothing is projected that might not happen.
  Non-obvious decisions:
  - **Movements live in `PYRAMID_LADDER`, deliberately NOT in `EX`.** EX ORDER IS
    LOAD-BEARING — adding a plain push-up to the chest compound block would
    displace `floor_press`, which must LEAD there for the left shoulder. Keeping
    them out also means the generator can never program them. They carry `type`
    so `exFull` passes them through and `SECONDARY_CREDIT_RULES` still fires
    (100 pull-ups' worth of biceps credit is exactly that table's motivating
    case). `options` is a preference list resolved per-day against equipment +
    `userAvoids` + hip/shoulder caution, so a bar-less day drops the pull rung
    instead of prescribing something undoable, and blacklisting `situps` swaps
    that rung out with no code change.
  - **MRV is priced by REPS, not sets** (`pyramidMrvSets`). A set count would
    bill 19 rungs × 5 movements = 95 sets — the century bug an order of magnitude
    worse. The rate is derived from the ONE anchor already in the file: a Century
    is 100 pull-up reps for `CENTURY_MRV_SETS`, i.e. ~33 reps per recoverable set
    for a movement whose range centres on 6, scaled by the target movement's own
    range. Falls out of it as a check: the ×1 rung at peak 10 prices at exactly
    `CENTURY_MRV_SETS` — **the same 100 pull-ups cost the same whether they
    arrive as a Century or as a ladder**. Measured at peak 10: back 3 / triceps
    3.1 / chest 2.9 / core 4.5 / legs 3, plus secondary credit.
  - **Logged as a REAL session (no `isCardio`)** — the opposite of the Century.
    1,500 reps across five movements IS the day's training, so it marks the day
    completed, feeds recovery, and locks the template. The Century is invisible
    to session bookkeeping precisely because it rides ALONGSIDE a session.
  - A peak-10 ladder is 100 pull-ups, so `centuryHTML` defers to it
    (`pyramidCoversCentury`) rather than asking for a second hundred. A shorter
    ladder does not, and the Century card still appears.
  - Never a lunch: high-sweat and ~50 min fails both lunch constraints. The card
    says so in words on a lunch-only day rather than vanishing.
  - **The 400-sit-up rung is the one part flagged to Sam as questionable** —
    high-rep loaded lumbar flexion against a stated lower-back history. Left in
    (it's the prescription, it's not on his avoid list, and the core cycle
    already includes `flexion`), with the concern written into the movement's cue
    and a documented swap path via the avoid list.
  - Draft state `S.pyramid` = `{date,rung,startedAt,touchedAt}` — `rung` counts
    COMPLETED rungs, matching how the session is actually run. Cloud-synced by
    the shared `mergeStampedDraft` (see the Century's note on why
    `SINGLETON_FIELDS` and `unionById` both fail for session drafts).
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
- `LUNCH_LEDGER` / `lunchBudget` / `lunchExMins` (2026-08-03, extended
  2026-08-05): the 40-min lunch is a real ledger — box − spine − **prep** −
  century − lifts, and a finisher only if what remains covers it.
  **`prep` was the third invisible spender**, found 2026-08-05 from Sam's report:
  *"the timing for duration for the first exercise is going to be way longer
  every time bc the mobility movements and stretches are grouped into it.
  Probably the main reason I wasnt able to finish my century today."* The whole
  warm-up block renders in front of exercise 1 and none of it was charged, so
  the ledger promised three lifts and a century inside a box already ~6 minutes
  spent. Consequence, accepted: **an ordinary lunch is now 2 lifts, not 3.**
  `lunchExMins()` also had to subtract prep before dividing — it must be a
  MARGINAL rate ("what does one more lift cost"), and smearing a once-per-session
  overhead across every exercise inflates it worst on the 1-lift century day,
  which is the one the clock actually broke on. It replaced a flat "3 exercises, minus some on a century
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
- `fundamentalHabits()` / `dailyHabitsHTML()`: the daily habits list — protein at
  target bodyweight, sleep, walking, caffeine+alcohol timing (fibre/satiety and
  the 80%-week rule were dropped 2026-07-28 as too obvious to earn dashboard
  space; the consistency argument still lives in the closing "subtraction"
  callout). Explicitly NO biohacks — no supplement stack, fasting window, cold
  plunge, or readiness score. Keep it that way; the point is habits that survive
  a workday. The card's "N habits" line is DERIVED from the array length — a
  hardcoded count went stale the first time the list was edited.
  **Was `fundamentalsHTML()` until 2026-08-03**, when Sam cut it back: "I do not
  need the fundamentals box as long as they are incorporated into the algorithm —
  you can leave in the daily habits part since those aren't a part of the program
  planning." That's the dividing line for this card now: **anything the scheduler
  already enforces gets no dashboard space to report on itself.** The Foundation
  Five coverage rows and the Pull-up Century schedule block both went. Neither
  was load-bearing — `FOUNDATION_FIVE` is enforced by `dayTemplate` stamping
  `slot.foundationId` and `pickEx` honouring it (still seeded from
  `foundationCoveredThisWeek`), and `centuryDows` still schedules centuries with
  nothing printing the day list. What was lost is REPORTING, on purpose. **The
  one real cost:** those rows were the only place the two documented coverage
  gaps were explained in words (`pushups_w` on an all-YMCA week, `bear_crawl` on
  a lunch-only week). Both gaps still exist by design and are now silent. The
  `placementNote()` helper that worded them is in git if it's ever wanted back.
- **Body Score card: removed from the dashboard 2026-08-03** ("not needed").
  `renderBodyScoreCard` is gone, but `S.cfg.bodyScore` is NOT dead data — it is
  the source of the protein target in `fundamentalHabits()` and of
  `cfg.bodyLbs`. The deleted card held the only button that opened
  `renderScanModal`, so the `edit-body-score` trigger moved to the **Plan
  screen** rather than disappearing; without that, a measured input would have
  been frozen forever. The modal itself always rendered independently (off
  `S.editScan`, in the modal-root writer) and was unaffected.

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
  sweating at lunch). These used to be explained in words on the dashboard; that
  card was removed 2026-08-03, so both gaps are now silent by choice.
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

## Fourth pass (2026-08-05) — the century vs the MRV ledger

Sam: *"How does the century work into the MRV. I dont need to kill my back and
biceps as much bc im doing century now."* He was right, and the cause was not
the price — it was that **the budget never saw a century until it was logged**.
Generation runs Monday morning with zero centuries in the log, so the whole
week's back and biceps work was planned as though 300 pull-ups weren't coming,
and then they landed on top. Measured, 6 weeks, lunch+3-evening: back finished
at 24 sets against a 12–22 band, **every week**.

Three changes, and all three are load-bearing together — shipping any one alone
measurably makes things worse:

1. **`getCommittedVolumes` projects the week's remaining centuries**
   (`centuryWeekVolumes`). Not circular: `centuryDows()` reads AVAILABILITY, not
   the program — the same property that lets `dayTemplate` consult it
   mid-generation. Missed past centuries are NOT projected, matching
   `getMRVBreakdown`'s rule for scheduled sessions.
2. **`CENTURY_MRV_SETS` 3 → 5.** A pull-up working set is 4–8 reps, so 100 reps
   is ~16.7 nominal sets; at 3 the discount was 0.18, i.e. a century set counted
   as under a fifth of a hard set. 5 makes it ~0.30 — about a third, the
   conventional weighting for sets left well short of failure.
3. **Pattern coverage** (`patternUnder` in `dayTemplate`'s rows + the mandate
   exemption in `pickEx`'s `fitsMRV`). **This is the non-obvious one.** With 1+2
   alone the century fills back's weekly MINIMUM single-handed, back stops
   ranking as "under range", the day stops choosing it — and the horizontal and
   rear-delt mandates vanish silently: measured **60% of weeks → 0%**, and on
   the 3-evening profile programmed back work went to **literally zero**. A
   century is 100 VERTICAL pulls and cannot cover a row no matter how many of
   them there are. So back's `under` test measures volume the centuries did NOT
   supply, and `patternUnder` additionally overrides the `headroom>=2`
   eligibility filter, because on an efficiency week two centuries fill the 3–10
   band outright. Deliberately **back-only**: for BICEPS the secondary credit
   from 300 pull-ups IS real elbow-flexor work and curls genuinely are redundant
   against it — that's what `SECONDARY_CREDIT_RULES` is for.

A FOURTH bug fell out of this, pre-existing and silent: **a century had never
credited biceps at all.** The century-finish handler logs its exercise as
`id:'pullup_century'`, which is not in `EX`, so `exFull()` couldn't recover a
`type` and `secondaryCredit()` returned null — the one case
`SECONDARY_CREDIT_RULES`' own comment names as its motivating example. Primary
credit still worked, which is why nothing looked broken. Fixed with
`EX_ID_ALIASES` in `exFull` rather than by changing the writers, because an
alias repairs historical logs too. **Any future synthetic log id needs an entry
there** — the failure mode is silent by construction.

Measured (6 weeks × 3 schedules, daily replan, centuries logged under their REAL
log id, baseline = `git show 443a02a:index.html` through the same harness).
**Programmed** = sets the generator prescribes, excluding century reps — the
number Sam's request is actually about:

- **lunch+3 evenings** (the main schedule): programmed biceps 5–6 → **0–3**;
  programmed back 6–9 → 6, i.e. **2 back exercises/week instead of 3**. Back MRV
  total 15–18 → 21 of 12–22 — in band and honest, where before it was in band
  and wrong. Legs, core, chest, shoulders, triceps all still in band.
- **3 evenings only**: programmed biceps 6 → 3, programmed legs 6 → **9**
  (a bonus — freeing back slots let legs take the depth), everything else and
  every mandate unchanged.
- **lunch-only**: programmed biceps 2 → 0, triceps 2 → 3, back MRV 12 → 18.

Accepted costs, measured not assumed:
- **The two back accents now trade off instead of both landing.** On the full
  schedule `horizontal` went 100% → 60% of weeks while `rear_delt` went 50% →
  100%; total accent coverage is a shade better (150 → 160 accent-weeks) on a
  third less programmed back volume. This is the structural limit already
  documented below — three claimants for the back slots recovery debt allocates
  — and cutting back from 3 exercises/week to 2 is the direct, requested cause.
  Do NOT "fix" it by giving back a third slot; that undoes the whole change.
- **Back can overshoot its ceiling on a heavy century week** — one week of five
  hit 27 of 22 on the full schedule, and the efficiency profile sits at 13 of
  10. That is `patternUnder` buying a row at the cost of a nominal overshoot.
  The band counts recoverable HARD sets and most of what filled it was
  deliberately submaximal pull-up reps, so overshooting on paper is much the
  smaller error against deleting horizontal pulling from the program.
- **An ordinary lunch drops from 3 lifts to 2** (century lunch stays at 1), from
  charging prep to the ledger. Knock-on: lunch-only weeks lose ~3 programmed leg
  sets. Lunch-only weeks were already documented as structurally under-band.

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
