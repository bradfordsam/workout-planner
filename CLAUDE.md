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
- **`JUMP_DURABILITY` (2026-08-17)** — Sam: *"the workouts i wanted to start doing
  to increase my durability playing volleyball (repeated vertical jumping as a
  blocker on sand)"*, and *"i get gassed and cant jump that high right now"*.
  **He does NOT play on a schedule.** A first pass modelled volleyball as a league
  NIGHT that consumed an evening, booked MRV and reset the leg clock; that was
  exactly backwards and is fully reverted (a `load()` migration deletes
  `cfg.volleyball` so it can't ride back in from a device that saw it). This is
  TRAINING FOR a demand, so it is programmed work and costs the week what any
  other programmed work costs. It touches no recovery window and no availability.
  - **Both target movements were DEAD CODE**, which is the real finding here:
    `repeat_block_jumps` and `soleus_raises` (added upstream 2026-08-14) took
    **zero picks in 6 simulated weeks on all three schedules** — as did every
    other jump and calf movement. Structural: legs get ~2 slots/week and both are
    mandated (evening `strength`, lunch `hinge`/`hamstring`), and the athletic
    accent branch that would ask for jump work only fires on a THIRD leg slot
    those schedules never produce. The exact silent-dead-code trap the EX-ordering
    note warns about — a never-picked entry looks identical to a working one.
  - **Two paths, because the two pieces are different shapes of work:**
    1. **Repeat-jump capacity is CONDITIONING, not a lifting slot.** Six sets of
       continuous submaximal jumps is a finisher-shaped dose. Carving it a leg
       slot was tried and measured at **20% of weeks** — and it cost
       `pistol_squat` 100% → 0%, a straight swap of one leg guarantee for
       another. So the existing `Block Jump Capacity` finisher is guaranteed on
       the week's **first evening SESSION**, and the coverage test is
       `eveningTrainedThisWeek()` — log-based, exactly like
       `foundationCoveredThisWeek`. It was already in the pool and reachable, but
       only by dow arithmetic: `pool[dow%pool.length]` surfaced it on Saturdays
       at the YMCA and **never at Westminster**, where the sprint entries make
       the pool longer. A block he is actively trying to start cannot depend on
       which index a location's pool lands on.
       **Keyed to the evening actually TRAINED, not to a fixed dow** (Sam: *"the
       jumps can be done on the evenings not just saturdays, right?"*). The first
       version pinned it to the first evening on the SCHEDULE, i.e. Tuesday — so
       a skipped Tuesday cost the whole week's jump work at any gym whose
       rotation doesn't happen to surface it again. Same failure the Foundation
       Five's log-only seeding exists to prevent: a guarantee keyed to a calendar
       day evaporates when that day is skipped. It converges instead — before the
       week's first evening EVERY remaining evening offers it, and the moment one
       is logged the rotation takes back over.
    2. **Soleus work IS a normal set** — not sweaty, lunch-compatible — so it
       rides the weekly Foundation stamp, TRAILING the Foundation Five so it
       yields while any of them are outstanding.
  - **`repeat_block_jumps` was missing `highSweat`** and that was a live bug, not
    a nicety: 15–30 continuous jumps is unambiguously sweaty, comparable entries
    (`jump_squats`, `lateral_bounds`, `burpees`) all carry it, and without it the
    weekly stamp put it on no-shower YMCA lunches. Symptom in the sim was a week
    with **zero leg sets** on the lunch-only profile — the slot was stamped with
    a movement `pickEx` then refused, and dropped. Consequence, accepted: a
    lunch-only week gets no jump work at all, the same structural gap
    `bear_crawl` has.
  - Measured vs `origin/main` (6 wks): lunch+3-evening and 3-evening are
    **identical** on every muscle, mandate and leg-set count; lunch-only loses
    hinge 80% → 60%. The jump capacity arrives on top, in the finisher budget,
    costing the lifting nothing. (The soleus-gains-20%-of-weeks figure this
    line originally reported is now moot — see `CALF_WEEKLY_TARGET_SETS`
    below: measured again on 2026-08-19, the soleus stamp actually landed 0 of
    10 simulated weeks, and that mechanism is retired in favor of the one
    described there.)
  - `S.cfg.jumpDurability` toggles it (Plan screen). Defaults ON via
    `!==false`, so it is live without a migration.
- **`CALF_WEEKLY_TARGET_SETS` (2026-08-19)** — Sam: *"make sure I get at least 2
  sets of calves a week in programming."* Measured first, same method as every
  other feature in this file: **0 of 10 simulated weeks on all three schedules**
  had ANY calf-tagged set land, including lunch+3-evening. The JUMP_DURABILITY
  stamp above (`soleus_raises`, riding the Foundation Five's weekly-guarantee
  queue) was the only existing mechanism, and it was dead code for a structural
  reason: legs produces only ONE slot a week that queue can even contest — the
  accent slot, once heavy strength is already banked; every other leg slot
  carries a hard mandate — and `pistol_squat` sits ahead of it in that SAME
  single-stamp-per-session queue, so it won that one slot every time (measured
  10/10 weeks on the full schedule, 0/10 for soleus). **That queue is the wrong
  mechanism for this** — `JUMP_DURABILITY` is now `[]` rather than left to lose
  forever (the note above it explains why; the stale "soleus 0%→20%" line in
  the note above that no longer applies now that this replaces it).
  - **Doesn't compete for a leg slot at all.** `needsCalfTopUp()` (log-seeded,
    same convergence rule as Foundation Five — a PLANNED top-up doesn't retire
    it, only a LOGGED one does) gates a small, independently-priced append in
    `buildSession`: 2 quick sets from `CALF_TOPUP_POOL`, tacked onto whichever
    session finishes building first this week, outside the muscle-slot system
    entirely. `pickCalfTopUp` applies the same safety gates
    `canPlaceFoundation` does (equipment, hip/shoulder caution, plyo, avoid
    list, knee caution) via the same helper functions.
  - **Priced like a small McGill block, not a full lift**
    (`CALF_TOPUP_MINS=2`), charged into `eveningLifts`/`lunchBudget`'s fixed
    cost BEFORE the lift count is sized — same reasoning as the century/
    finisher, and the reason it must NOT be counted in `sessionPlan`'s "N
    lifts" line (that would double-charge it at the full ~11–12 min per-lift
    rate). The render call site excludes `calfTopUp`-flagged exercises from
    the count it hands to `sessionPlan`; `sessionPlan` re-derives
    `needsCalfTopUp()` independently and prices it as its own line, exactly
    the pattern century/finisher already use for "does THIS session pay."
    Skipped entirely on a lunch hosting the century — that box has no room for
    anything past the hundred, same as the spine holds.
  - **Two real regressions found and fixed before this could ship**, both
    from the SAME root cause and both caught by the mandatory 3-schedule
    balance sim, not by inspection:
    1. Appending the top-up credited 2 sets to `budget.vol.legs` at
       GENERATION TIME, on whatever session happened to build first — which
       could be a chest day, a back day, anything. `budget.vol` also drives
       THIS WEEK's remaining anchor-priority ranking (which muscle is "under"
       and gets picked next), so a phantom 2 sets of legs credit early in the
       week made legs look caught up and the recovery-debt engine kept
       skipping it as an anchor. Measured: hinge and hamstring mandate slots
       collapsed to **0/week on the full schedule** (were 5 and 4). Fixed by
       NOT crediting `budget.vol` for the top-up — `getWeeklySetVolumes()`
       (the dashboard's real number) re-derives everything from LOGS once it's
       actually performed, which is a completely separate computation, so the
       true volume is never lost; only this run's remaining slot decisions
       don't see it early.
    2. Once landing on non-leg days (any session, by design — see above), the
       top-up made `weightedLegEx`/`weightedLegLog` (the **weighted-only legs
       rule**, `countsForRecoveryEx`/`Log`) see a `legs`-muscle exercise and
       mark that date as legs-trained, because `calf_raise`'s `eq` includes
       `'machine'` (non-bodyweight) — the SAME rule that already exists to
       keep bodyweight pistol-squat-style work from resetting the 72h heavy
       clock never anticipated a genuinely LOADED-by-`eq` movement that still
       shouldn't count. This is the ROOT-CAUSE fix, not a special case for
       this feature: `weightedLegEx`/`weightedLegLog` now exclude any
       `tags.includes('calf')` movement outright, regardless of load — a calf
       raise never touches the squat/hinge pattern the 72h window exists for,
       however heavy it's loaded. `weightedLegLog`'s calf check has to run
       BEFORE the logged-weight check, not just live in the DB-entry fallback,
       because a genuinely loaded calf raise still logs `weight>0` and would
       otherwise sail through the first branch. This is general — it also
       correctly covers Sam manually swapping a calf exercise into any slot,
       not just this top-up.
  - Both bugs were invisible to a single-day snapshot and only showed up
    across a **daily-replan** simulation, exactly the trap this file's Deploy
    Workflow section warns about — the first fix (removing the volume credit)
    looked complete in isolation and only the second sim run surfaced that
    `mandates`/`goal.legAllowlistBreaches` were still wrong.
  - **`analysis/case-study.js` needed two of its own updates**, both
    documented inline there: `legAllow` (the harness's own replica of
    `LEG_EMPHASIS_TAGS`) now includes `'calf'` as a narrow, deliberate
    exception — plain calf raises are excluded from AUTO-GENERATED leg
    programming everywhere else by design (`LEG_EMPHASIS_TAGS`'s own comment:
    "pure hypertrophy/strength... excluded from auto-generation everywhere");
    this is the one guaranteed carve-out, the same shape Foundation Five
    already has for `pistol_squat`. And the harness's own lockout-gap replica
    of the weighted-only legs rule needed the same `'calf'` exclusion the real
    `weightedLegEx` got, or it flagged false lockout violations the real app's
    scheduler was never actually making.
  - Measured after both fixes, `git show 62d462a:index.html` baseline (10 sim
    weeks, daily replan, all three schedules): **calf sets/week 0/10 → 10/10
    on every schedule**; `mandates`, `goal`, and `lockout.legs.violations`
    (0 everywhere) are **byte-identical** to baseline; legs weekly volume +2
    (still under band on the two schedules already documented as
    structurally under-band — a welcome, not a regression); `pistol_squat`
    coverage untouched at 10/10 on the full schedule.
- **Custom Session** (2026-08-29, `renderCustomSession` / `startCustomWorkout` /
  `customRowPlan`) — Sam: *"add a custom workout plan to do rather than what the app
  prescribes sometimes… I input the exercises I want to do, and the app prescribes
  the appropriate warm ups and starting weight recommendations."* Pick the
  movements; everything else is the ordinary session machinery.
  - **Do not confuse it with the pre-existing custom-workout LOG**
    (`renderCustomWorkoutLog`, `plan-custom-workout` / `log-custom-workout`). That
    screen is a FORM filled in AFTER training — you type sets, reps and weight and
    it writes a log. This is a SESSION you RUN. Three verbs now sit on the today
    card and they are genuinely different: **Plan** schedules one for a later day,
    **Log** records one that already happened, **Build My Own Workout** runs one now.
  - **The picked list is handed to `renderWorkout`, so nothing is re-implemented.**
    `prepPlan`'s warm-up block, the 50/75/90% acclimation ramp, `smartRest`, the
    per-set logger, `sessionPlan`'s itemised clock and `estimateStartingWeight`'s
    opener (with its confidence and its basis in words) all arrive by construction.
    The only new work is turning names into the `S.active.exercises` shape. It calls
    the SAME `flagFirstWorkingSet`, two-per-day cap, `applyDailyAutoReg` and lunch
    set clamp `startWorkout` does — deliberately not `startWorkout` itself, which
    reads a PROGRAM day (make-ups, `eveningSession`, the preserved-session path).
  - **RIDES ALONGSIDE, does not replace** (Sam's call). `adaptWeekForCustomWorkout`
    is deliberately NOT called: the log lands, `finishWorkout` calls
    `replanCurrentWeek`, and recovery + MRV absorb it like any session. Consequence
    worth knowing: `getCompletedDows` keys off ANY non-cardio log on the date, so
    today's card flips to "✓ Completed" regardless of which session ran. That is
    honest, and the evening block keeps its own Start button.
  - **The safety gates WARN, they do not block** — the one place this path diverges
    from `pickEx`, and it is deliberate. Those gates stop the GENERATOR prescribing
    something Sam never asked for; here he is naming it. Silently refusing a
    movement he typed is the "monitor that fires on correct plans" failure in the
    other direction — he'd stop using the feature. `customExWarnings` therefore
    calls the engine's OWN predicates (`userAvoids`, `plyoHidden`, `KNEE_SAFE_IDS`,
    `dragonFlagUnlocked`, the same `hipRisk`/`shoulderRisk`/`highSweat`/equipment
    tests `baseFor` uses) rather than re-deriving them, so a change to those follows
    automatically. The over-budget clock warns the same way and names what will give.
  - **`eq:['other']` on a synthesized (unmatched-name) movement is load-bearing.**
    It must be a token no preset carries — so the equipment warning is honest — while
    still passing `renderWorkout`'s `pctScalable` test, which only asks that SOME
    token isn't bodyweight/medball. `eq:[]` or `eq:['bodyweight']` silently
    suppresses the warm-up ramp, i.e. the exact thing the feature was asked for, and
    it fails invisibly: a missing ramp looks identical to a movement that has none.
    A per-row `bodyweight` checkbox is the deliberate way to get `noWeight` instead.
  - **Typed names get a SLUG id (`slugId`), never `Date.now()`.** The log-edit
    screen's `'custom_'+Date.now()` would mint a fresh id per session, so a
    hand-typed movement could never accumulate history and `estimateStartingWeight`
    would never get past step 4. Same movement next week → same id → real progression.
  - **`estimateStartingWeight` and `exFull` now resolve through `exById`**, which
    covers `S.customExercises`. It used to be `EX.find`, so every one of Sam's own
    exercises fell straight through to the cold-start default even with its own
    history or an in-group anchor available — silent, and indistinguishable from a
    working estimate. Fixed here because the custom picker makes it reachable daily.
  - **Templates store NAMES + set counts, not resolved exercise objects.** A template
    loaded six weeks later must re-resolve against the current database and current
    history so the starting weight reflects the intervening training; freezing the
    objects hands back a stale prescription. `deleteCustomTemplate` **TOMBSTONES**
    (`deleted:true` + `editedAt`) rather than splicing — `unionById` keeps the cloud
    copy for any id it already holds, so a spliced template resurrects on the next
    sync. Same rule as `mergeStampedDraft` and `pickNewerEdit`: a merge that cannot
    express DELETION cannot merge a list with a delete button. Synced via
    `unionById(..., pickNewerEdit)` in BOTH merge paths (`loadFromCloud` AND
    `saveToCloud`'s read-merge — fixing only one looks fine until the 60s read
    throttle lapses).
  - **`csEncodeName` exists for one reason**: the suggestion's `onmousedown`
    interpolates a name into a JS call inside a SINGLE-quoted HTML attribute, and
    `encodeURIComponent` deliberately leaves `'` unescaped. No built-in name carries
    one, but a custom exercise easily does ("Farmer's Carry") — and the failure is
    silent, the row just stops being pickable. Caught by the render smoke test, not
    by the syntax check.
  - Verified with a render smoke test (108 assertions: every new render path, both
    session types, every exercise index, the template round-trip, the quoted-name
    case) and the full case-study harness — **all 7 scenarios byte-identical to
    `git show HEAD:index.html` through the same harness**, since `dayTemplate`, MRV
    pricing and the lunch ledger are untouched.
  - **Second entry point, the Weekly Program tab (2026-08-31)** — Sam reported not
    seeing the dashboard button and, after an Android PWA cache-clear didn't fix
    it, asked to put it somewhere he'd find more easily rather than keep
    troubleshooting a device he couldn't hand me. `renderProgram()` now carries the
    same `build-custom-session` button, unconditionally at the top of the page —
    the trigger (`customSessionInit()`) was already view-independent, so this is
    the same action wired to a second place, not a second implementation. The
    dashboard button stays; this is additive. **The root cause of the original
    report was never confirmed** — service-worker version bumps (v80→v82 across
    this and the prior two turns) were the standing hypothesis, tried in case the
    real cause was something more specific to his device that a session with no
    access to his phone or the live URL (network egress to the deployed domain is
    blocked from this environment) couldn't diagnose further.
- **Estimator step 3b: comparability, not "the heaviest thing in the muscle group"**
  (2026-08-30, `loadComparability` / `loadBridge` / `loadClass`). Sam: *"it needs to
  scale to the most comparable movement for muscular load, not just barbell row."*
  - **The old rule was `best e1RM anywhere in def.muscle × 0.6`**, and the fatal part
    wasn't the 0.6 — it was that `muscle` is far too coarse to mean "loads the same
    tissue the same way". 'legs' is quads, hamstrings, glutes AND calves; 'back' is
    vertical pulling, horizontal pulling, rear delts and traps. Because the anchor
    was always the same in-group maximum, **every movement in a muscle group opened
    at the identical number.** Measured over all 106 loadable movements with a
    realistic history (`analysis`-style vm sweep, seeded squat 225×5 / leg press
    360×10 / bb row 155×8 / machine press 170×8): **55 of 106 resolved through this
    step** — Calf Raises, Leg Extension and Bulgarian Split Squats all at **290 lb**
    off the leg press; Reverse Flyes and Dumbbell Pullover at **120 lb EACH**;
    DB Flyes at **130 lb each**.
  - **Three GATES, each added because the sweep produced a number nobody would
    attempt.** They are hard filters; the score only ranks what already passed.
    - **REGION** — sub-muscle tissue, read off tags EX already carries
      (`quad`/`hamstring`/`glute`/`calf`/`soleus`/`adductor`/`vertical`/`horizontal`/
      `rear_delt`/`trap`/…). Two movements that each name a region and share none
      don't load the same tissue and no coefficient bridges that. A leg press cannot
      tell you what you calf raise.
    - **TYPE** — compound vs isolation is the single biggest load gap and has no
      defensible generic ratio. Without it a 360 lb leg press prescribed a **360 lb
      leg extension** and a 170 lb machine press a **170 lb cable fly**.
    - **LOADING** — a bodyweight movement's weight box means ADDED load; a stack's
      means total load. Different quantities, never cross. Without it a 170 lb
      machine press prescribed a **170 lb weighted vest** for push-ups.
  - **`loadClass` is now shared with `coldStartWeight`** rather than duplicated —
    two functions answering "what does this number physically mean" separately is
    exactly how `getLockedMuscles`/`legsRecovered` drifted. **It tests bodyweight
    implements FIRST**, which the old inline version did not: `eq` lists what can
    HOST a movement, not how it's loaded, so Inverted Row
    (`eq=[barbell,cables,machine,pullup_bar]`) was classed as a barbell lift and
    inherited a barbell row's 155 lb. A bar you hang from supplies no resistance, so
    `pullup_bar` sits with `bodyweight`/`own_gear`. **But bodyweight-class means NO
    external-resistance implement, not merely `bodyweight` present** — testing for
    presence was measured and was wrong: most leg lifts list it to mean "can be done
    unloaded", and that test threw away every good anchor they had and dumped the
    whole leg pool on the cold-start default.
  - **`bwBase:true` on `inverted_row` is the one explicit override**, in the spirit
    of `startW`. Swept the pool: exactly ONE movement lists a non-resistance host
    alongside a resistance implement and is really bodyweight. Everything else
    pairing `bodyweight` with an implement (Bulgarians, hip thrusts, calf raises) is
    genuinely loaded by it.
  - **PATTERN tags are scored separately from region, and that is load-bearing.**
    `squat`/`hinge`/`lateral`/`carry`/`isometric`/`power`/`eccentric` are NOT in
    `LOAD_REGION_TAGS`, and leaving them out of the score was a measured misfire: a
    Bulgarian scored the back squat (shared region `quad` AND pattern `squat`)
    *below* the leg press (shared region only), purely because the leg press's rep
    range sat closer — and took a 360 lb machine as its reference. Pattern outranks
    rep proximity, which is the weakest signal here.
  - **A `loadFamily` tie-break (free / supported / bodyweight)** catches what the
    implement match misses: a machine stabilises you and a free weight doesn't.
    Without it, standing unilateral work (step-ups, reverse and lateral lunges)
    anchored to the leg press and opened at 100 lb per hand.
  - **Epley is applied ALWAYS, not only when rep ranges miss.** Identical rep targets
    cancel exactly (in and out), so the branch that skipped it bought nothing and got
    the edge case wrong — ranges touching at a single rep counted as "overlapping",
    handing a deep 8–12 ATG squat the full 4–8 back-squat working weight. Same trick
    the heavy 1–5 tier's `pct` anchors use, and it self-scales with no per-movement
    constant.
  - **Leverage across implements is deliberately NOT bridged.** The ratio swings from
    ~1.8 (leg press vs back squat) to ~0.95 (machine press vs bench), so no single
    constant is honest. It is handled by PREFERRING a same-implement anchor in the
    score — pick a better reference rather than invent a conversion. The only
    coefficients applied are ones with a stated basis, both reused from
    MOVEMENT_CLASS rather than invented: per-hand↔total 0.5/1.9 (`db_row` from
    `bb_row` is coef 0.5), and bilateral→unilateral 0.55 (that table's own note
    records RFESS *total* reading ~55% of a back squat).
  - **When nothing is comparable it now refuses to answer** and falls to step 4,
    whose bodyweight × muscle × type × equipment table already knows a rear delt fly
    is not a row. `source` is `'comparable'` (was `'group'`); the basis line names
    the movement AND why it was chosen, since an unexplained anchor was the
    complaint. Distribution went 55 group → 25 comparable + 30 more on the honest
    default.
  - **Result, same sweep**: Calf Raises 290 → 90, Leg Extension 290 → 90, Reverse
    Flyes 120 → 20 ea, DB Fly 130 → 20 ea, Face Pulls 120 → 40, weighted push-ups
    130 → 40, Bulgarian 290 → 55 ea **via the squat** (≈ MOVEMENT_CLASS's own
    documented 55% figure), step-ups 290 → 55 ea via the squat rather than 100 ea via
    a machine. A plausibility sweep (isolation < 1.2× bodyweight total, compounds
    < 2.5×, legs < 3×) flags **nothing**; before the change it flagged the leg pool.
    All 7 case-study scenarios byte-identical to `origin/main` — this touches
    prescription, not scheduling. **Re-run the sweep after editing EX tags**, since
    region and pattern matching read them and an untagged movement silently loses
    its best anchor.
- **Paired sets, clusters, EMOM and the front-rack/decline movements** (2026-08-30)
  — Sam brought in four workout cards using A1/A2 pairs with "Rest 10 seconds"
  between and "Rest 90 seconds" after, a cluster-set note on the pull-ups, and an
  EMOM 20 Full Body. All four pieces landed; the structural ones are below.
  - **New movements (4, plus one rename).** `front_rack_db_squat`,
    `heels_elev_front_squat`, `feet_elev_pushup`, `parallel_pullup`. Each is placed
    AFTER the movement leading its block, so none displaces an established pick —
    which per the EX-ORDER rule also means the generator will rarely choose them.
    Stated rather than discovered later: **they are here to be picked by hand** in
    the custom builder and the swap list, which is where the workouts they came
    from live. Two are deliberate shoulder/hip accommodations: the front rack forces
    an upright torso (keeps the femur out of the flexion+adduction corner the left
    hip objects to) and `parallel_pullup`'s neutral grip is the least pinchy
    vertical pull there is — **if the pronated bar ever nags the left shoulder,
    moving that entry above `pullups` is the one-line change that makes it the
    default.** `feet_elev_pushup` carries the same SHOULDER STOP cue as the rest of
    the pressing, more so because the decline drives the humerus further behind the
    torso. **"Side to Side Push-ups" is `archer_pushup`**, renamed to
    "Archer / Side-to-Side Push-ups" rather than duplicated — a near-identical
    second entry would dilute the chest block's EX order for no new training
    effect, and the NAME is what the autocomplete searches.
  - **`CLUSTER SETS`** — the protocol's *"if you can't do 3 sets of 5"* is a
    condition the app can EVALUATE, so it does. `clusterPlan` reads the best
    unbroken set actually logged for that exact movement and prescribes 1 rep /
    15–30s / repeat when it's under 5. Three decisions worth keeping:
    - **Keyed on the `vertical` tag, not an id list** — a movement added to that
      family later is covered without editing this.
    - **Per-movement history, with the Century as the one alias.** Grip and added
      load change the number completely, so weighted, chin-up and neutral-grip
      histories stay separate; `pullup_century` maps to `pullups` through the
      `EX_ID_ALIASES` entry that already exists for secondary credit.
    - **ALL history, not a rolling window.** This decides whether a rep target has
      been PROVEN, and proof doesn't expire the way current form does — that is
      what `CENTURY_BEST_WINDOW` is for. Windowing it would put him back on
      clusters after a quiet fortnight.
    - No history at all is **not** a trigger: an unknown is not a weakness.
      Consequence, and it's the right one: because Sam does Centuries, bodyweight
      pull-ups will essentially never cluster. Where it fires is `weighted_pullups`
      (rMin 3 by design) and any bar variation he hasn't built yet.
  - **`PAIRED SETS`** — `S.cfg.pairedSets`, **off by default**, Plan-screen toggle
    beside the separate/circuits control. `pairSession` assigns `pairId`/`pairPos`
    and reorders so partners sit adjacent.
    - **Runs AFTER `flagFirstWorkingSet`, never before** — it reorders, and the
      lift carrying the warm-up ramp has to stay at index 0 and simply become A1.
    - **What is never paired matters more than what is**: `strength` (the heavy
      1–5 @ 85–95% tier — ten seconds of rest is the opposite of what it needs, and
      the weekly heavy-leg mandate is the last guarantee worth degrading),
      `power`/`ballistic`/`plyometric` (trained by speed; a fatigued explosive rep
      is a worse rep, the same reasoning that already excludes them from back-off),
      and **two movements of the same muscle**. The source cards do pair leg with
      leg, but that's a giant set someone chose deliberately; as an automatic rule
      it just compounds fatigue on the day's anchor. Anything without a partner
      stays a straight set — an odd lift out is normal, not a bug.
    - **`PAIR_TIME_FACTOR` is derived, not picked.** `EVENING_EX_MINS` budgets 12
      min for a 3-set lift = 240s/set; the rest inside that is smartRest's middle
      compound tier (150s), so work is ~90s. A paired round is 90+10+90+150 = 340s
      for two lifts, i.e. 170s per lift per set against 240s — **~0.71**. One rest
      interval saved per round is the whole mechanism. It's an approximation on
      purpose (an odd lift pays full rate, and the ledgers size the count before
      the exercises exist) and errs toward charging too much.
    - **`perLiftMinsFor` is the single place the rate is decided**, used by
      `eveningLifts`, `lunchBudget` and `sessionPlan`, so the three can never
      disagree about whether pairing is on — the `getLockedMuscles`/`legsRecovered`
      failure.
    - **The workout screen renders a pair as ONE station.** `pairPartnerHTML` emits
      the partner's set rows using the SAME `sr-`/`w-`/`r-`/`db-` id convention
      keyed on its real index — which is the entire reason `completeSet` needed no
      change; the rows log to the right exercise because their ids say which one
      they are. `allDone` spans both halves (in the renderer AND in `completeSet`,
      which reveals the button without a re-render), Next skips the partner, Prev
      never lands on it, and the progress line counts STATIONS or it skips numbers.
    - **Paired work is straight sets, no back-off** — that's the protocol
      (3 × 6–15 across both), so `useBackoff` excludes anything with a `pairId`.
    - Measured: with pairing OFF all 7 case-study scenarios are byte-identical to
      `origin/main`. ON, a 60-min evening goes 3 → 4 lifts (45 → 3, 75 → 5, 90
      unchanged at the `exLimitFor` ceiling); **lunch stays at 2** — 22 available
      minutes against 7.8/lift is 2.8, genuinely short of a third — and gains 6
      spare minutes. Weekly volume: **no muscle exceeds MRV max on any profile**,
      and on the 3-evening profile shoulders go 0 → 3 sets, into band.
  - **`EMOM 20 · Full Body`** — built on the **CINDY** pattern, not the Pyramid's,
    because it is the same shape: fixed named session, round counter, spacing rule
    (`EMOM_EVERY_DAYS`), and a card that only prescribes itself when it can be run
    honestly. Logged as a **REAL session** (no `isCardio`) like Cindy — 20 minutes
    of squats, push-ups, pull-ups and hinges IS the day's training, so it marks the
    day complete, feeds recovery and books MRV. **Never scheduled by the
    generator**, same rule as the Pyramid and Cindy. Not prescribed on a Century
    day (the pull-up minutes and 100 submaximal reps are the same tissue) or
    alongside the Pyramid or Cindy. One set entry per movement holding TOTAL reps,
    because a per-round breakdown reads as N working sets to anything that doesn't
    know about the `emom` flag.
  - **EMOM is also a custom-session structure** (`CUSTOM_STRUCTURES`:
    straight / paired / emom). It is **timing, not volume** — same sets, same reps
    — so MRV, recovery and the ledgers price an EMOM exactly as they price the same
    list run straight, which is honest because it IS the same work. Its length is
    DERIVED as the total set count rather than asked for, so the two can't
    disagree. **The rest timer is suppressed entirely during an EMOM**: starting a
    150s rest inside a 60s minute would actively mislead, and the clock is the
    instrument. Hand-built pairing ignores the Plan-screen toggle on purpose —
    picking these movements and asking for them paired is a more specific
    instruction than a mode.
  - Verified: 122-assertion render smoke test, 22-assertion pairing test (rules,
    ledger, rest routing, navigation, station rendering) and 43-assertion EMOM /
    builder test, plus the MRV sweep above. **Re-run the pairing test after
    touching `flagFirstWorkingSet`, `completeSet` or the set-row ids** — the
    station model depends on all three.
- **Import a workout from a screenshot** (2026-08-30, `parseWorkoutText` /
  `resolveImportName` / `runWorkoutImport`) — Sam: *"make it so I can enter a
  screenshot of the workout and it generates it in this same feature and uses my log
  history and logic to fill in any holes."* Three stages, and only the middle one is
  new code: OCR the image, PARSE the text into rows, then hand the rows to the
  custom-session builder, which already fills every hole (`resolveEx` → the
  database, `customRowPlan` → sets/reps/rest, `estimateStartingWeight` → the opener
  from his own history).
  - **The result is a DRAFT in the builder, never a started session.** OCR gets
    things wrong; landing in the editor with every row visible and editable is what
    makes imperfect recognition acceptable rather than dangerous. Same reasoning as
    the builder's warn-don't-block safety gates.
  - **Tesseract.js is lazily fetched from a CDN** (`loadScriptOnce`, the same
    pattern the Firebase sync already uses) — a few MB of wasm and language data
    that most sessions never touch. `sw.js` is network-first and caches what it
    sees, so it works offline AFTER the first successful run; the first run needs a
    connection and `ocrWorkoutImage` says so rather than spinning forever.
  - **Every pattern is looked for BOTH inline and on the following line.** OCR
    flattens the cards' two columns unpredictably — "3 x 6-15 reps" sits to the
    right of the name and lands sometimes on the name's line, sometimes on its own.
    Assuming one layout silently halves the recognition rate.
  - **`RX_GUTTER` / `stripGutter` runs before any pattern match, never after**, and
    this was a measured bug, not a nicety: `RX_PAIR` is anchored, so one stray
    character OCR'd from the card's left rule (`| A1. Goblet Squat`) stopped the
    label being seen — and the knock-on was worse than a messy name. That row lost
    its pairing, which orphaned its partner, which then had its own label stripped
    as a dangling half-pair. **One misread pixel column cost a whole station.**
  - **An unstructured line is only an exercise if it NAMES one.** With no A1 label
    and no sets×reps there is no structural evidence at all, so the only evidence
    left is a database match. The earlier test — "two or more words" — passed
    `Some Gym` straight through as an exercise.
  - **`resolveImportName` relaxes the TIE rule, not the "is it close" rule.**
    `fuzzyMatchEx` refuses to answer on a near-tie, which is right for the
    autocomplete (a wrong confident guess is worse than "new exercise" while
    someone is watching) and wrong here: "Lateral Raise" on a card ties across five
    variants, so the strict matcher declined and the row landed as a NEW movement
    with a cold-start opener — throwing away the exact history this feature exists
    to use, with nobody typing to notice. Ties now break on EVIDENCE: the variant
    he has actually logged, most recent first; failing that EX order, which is
    already the generator's statement of the default. Verified both ways — with no
    history "Lateral Raise" resolves to DB Lateral Raise, and after logging the
    machine variant it resolves to that instead. Still returns null when nothing is
    close, and the review panel NAMES what it guessed.
  - **A stated rep range overrides the database's** (`applyRowReps`). The EX entry's
    rMin/rMax is what to do with a movement in general; a range written on the card
    is what to do with it today.
  - **EXPLICIT pairing beats inferred pairing.** A card that pairs two leg movements
    (Sam's do) is a deliberate instruction, and `pairSession` would refuse it — it
    declines same-muscle pairs because as an AUTOMATIC choice that stacks fatigue on
    the day's anchor. The safety rule governs what the app picks on its own, not
    what it was handed. So imported labels are carried onto the exercise objects
    **inside the map, before `flagFirstWorkingSet` reorders** (index alignment with
    `rows` cannot survive that), and `pairSortAdjacent` then restores partner
    adjacency without re-deciding who pairs with whom.
  - **`A1–A4` under an EMOM heading is a ROTATION, not four pair-stations** — the
    labels there mean order within the minute. Only a genuine two-per-letter layout
    is treated as pairing, and a dangling half-pair has its label dropped.
  - Anything the parser can't place goes to `skipped` or `notes` and is **shown**.
    A missing exercise you can't see is the failure mode that would make the whole
    feature untrustworthy.
  - Verified by a 34-assertion test driving text shaped like real Tesseract output
    from all four of Sam's cards, in both column layouts, plus OCR noise and garbage
    input. All four new movements and the archer/side-to-side rename resolve
    correctly. The other three suites and all 7 case-study scenarios are unchanged.
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
  **Which session pays for it (2026-08-17, `centuryHostSession` /
  `centuryChargeFor`)** — Sam: *"century should only effect exercises in one
  session because i am not doing it for both just one that day you know."* The
  **two ledgers each billed it independently** — `lunchBudget` charged every
  century dow AND `eveningLifts` charged every century dow — so on a
  lunch+evening day the same hundred pull-ups was paid for twice: the lunch
  dropped to one lift *and* the evening lost an exercise, for one session's work.
  Now `centuryChargeFor` is the single place that answers "does THIS session pay",
  and `centuryHostSession` picks the one host: the evening by default on a
  both-sessions day (`S.cfg.centuryWhen` flips it; Plan-screen toggle, rendered
  only when such a day exists), otherwise whichever session exists. The evening
  is chosen by default because it's the side with slack — it loses one slot off a
  4–5 template, where the lunch's hard 40 minutes lose half the session.
  Measured (6 wks vs `origin/main`): on lunch+3-evening the **horizontal mandate
  goes 20% → 60% of weeks**, shoulders 0% → 40% in band, biceps +2 and core +1,
  with legs/back/hinge/strength/hamstring unchanged. Lunch-only and 3-evening are
  byte-identical (no evening to move it to / no lunch to charge).
  **`exLimitFor(mins)`** replaces both the inline tier loop in `eveningLifts` and
  `EX_LIMIT[mins]||5`. Note the floor: it starts at **0**, not at the lowest
  tier's value — below the smallest tier no tier has been afforded, so the answer
  is one lift, not two. Seeding it with `EX_LIMIT[30]` handed 2 lifts to an
  evening with 14 minutes left after a century and a finisher, which showed up in
  the sim as +3 core sets a week on the efficiency profile.
  **Saying it's already done (2026-08-17, `century-already-done`)** — Sam: *"how
  can I say I have already done the century, don't include it in the schedule."*
  There was no way to; the only path to a logged century was tapping it out set by
  set. One button now logs a full hundred with three flags, each stopping a
  specific lie entering the numbers:
  - **`offSession:true`** — those minutes did not come out of a session this app
    budgets (done before work, at another gym), so `centuryBudgetToday()` reserves
    **0** and today's lunch keeps its full lift count. This flag is the ONLY thing
    that can zero the reservation, and it has to be an explicit statement from him
    because the app genuinely cannot tell 100 reps at 8am (minutes really free)
    from 100 reps at 12:05 (minutes that came out of the lunch it would then hand
    two extra lifts to). Any other logged century is still charged what it
    measured.
  - **`estimated:true`** — the rep TOTAL is known, the set breakdown isn't, so it
    stores an even split at the prescribed set size. `centuryStats()` excludes
    estimated logs from `best`, which matters more than it looks: an even split of
    100 would otherwise register as a monstrous unbroken set, and `best` sizes
    `centurySetPlan`'s set size AND `pyramidPeak` — one fake would prescribe sets
    of 50 and a peak-10 ladder off a number he never hit.
  - **`timedMins:0`** — "don't know how long", which `centuryMins()` already skips
    rather than averaging.
  MRV is unaffected and correct: 100 reps is 100 reps wherever they happened. The
  handler calls `replanCurrentWeek()`, since both the week's back budget and
  today's time box just moved.
  **Scaling an incomplete century (2026-08-17, `centuryMins` rewrite)** — Sam:
  *"scaling timing for incomplete centuries for scheduling purposes."* Every timed
  session now feeds the median with partials scaled pro-rata to a full-century
  equivalent FIRST, instead of partials being discarded the moment one completed
  session exists — and a partial is the common case on exactly the days the budget
  matters. Two guards, both conservative: `CENTURY_PARTIAL_MIN_REPS`(=30) below
  which an extrapolation is noise, and a scaled partial can never come in under
  `centuryDefaultMins()` (pro-rata systematically UNDERSTATES — the reps he got
  through are the fast early ones). The median is now a TRUE median (`median()`);
  `arr[floor(n/2)]` took the upper of two middle values, which was a small bias on
  a completed-only pool and a real one once bad-day extrapolations join it.
  `centuryBudgetToday()` additionally scales the reservation by reps ALREADY
  BANKED today — but a century already LOGGED today is charged its measured
  `timedMins`, **deliberately not zero**: the app can't tell 100 reps at 8am
  (whose minutes really are free) from 100 reps at 12:05 (whose minutes came out
  of the lunch it's about to hand two extra lifts to).
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
  **Undo (2026-08-31)** — Sam: *"I need an undo button for logging century."*
  The Done card had `centuryTimeEditHTML` to fix the minutes but no way to undo
  the log itself. Deliberately does NOT reconstruct the draft from the log and
  reopen the tap-in-sets card — that would need to fabricate a `startedAt` (the
  log stores `timedMins`, not the clock times that produced it) and treats an
  `estimated:true` "already did it" log identically to a real one when it has
  no real per-set breakdown to restore. Routes into the EXISTING soft-delete
  pipeline instead (`delete-log` → confirm modal → tombstone → 8s undo banner
  → `restore-log`), the same one History already uses for every other log
  type — cross-device-sync-safe by construction (`deletedSessions` tombstoning
  is exactly what stops a delete on one phone from being silently resurrected
  by a not-yet-synced second phone), and already has its own working undo.
  **Found and fixed on the way**: `renderDeleteModal`'s set-breakdown preview
  resolved exercise definitions with a raw `EX.find`, which misses everything
  `exFull`/`exById` exist to cover — `pullup_century` has no `EX` entry of its
  own (`EX_ID_ALIASES` maps it to `pullups`), so every century set previewed as
  "0 lb × N" instead of "N reps," and a custom exercise's own logged workout
  would have shown the identical wrong "0 lb" line. Never reachable before —
  no century-card button routed into this modal — so latent until now, same
  "silent until the path becomes reachable" trap as the custom-picker bugs.
  **Pacing card showing ~56 min (2026-08-31, `centuryPacingFor` /
  `CENTURY_SET_SAFETY_MARGIN`)** — Sam: *"right now it says approx 56 min for
  a century that is not right."* `CENTURY_SET_OVERHEAD_SECS=85` (per-set cost
  of getting back to the bar, chalking, waiting your turn) was calibrated
  against Sam's real ~10-set pace and correctly modelled his measured ~30 min
  there — but the SET-SIZING rule (half of `best`) was never checked against
  what happens when `best` is smaller. At `best`≈9–10, halving gives sets of
  5, which needs 20 sets to reach 100 — and 20 sets × 85s of overhead ALONE is
  28 minutes before a single rep or rest second is counted. `centuryDefaultMins`
  already capped the BUDGET this feeds at `CENTURY_MAX_BUDGET_MINS`(40), but
  nothing capped the Pacing block's own advice text, so the card said "sets of
  5, rest 75s" right next to a number those sets/rest don't actually add up to
  once something else (this budget cap) has silently clipped it. Simply
  capping the DISPLAYED number the way `centuryDefaultMins` does would have
  left that same self-contradiction, just at a different number — 20 sets of 5
  genuinely takes ~57 minutes if you follow the prescription printed next to
  the number.
  - **The fix grows the SET SIZE, not just clips the total** — fewer, bigger
    sets cost less cumulative overhead, and `centuryPacingFor(setSize,test,best)`
    lets `centurySetPlan` re-price a candidate size before committing to it.
    Bounded by `CENTURY_SET_SAFETY_MARGIN`(=2) — the numeric form of "every set
    2+ reps clear of failure" the whole protocol runs on, same figure
    `PYRAMID_PEAK_HEADROOM` uses for the identical rule on the Pyramid's top
    rung — so growth can never edge toward the near-failure territory the
    *scheduled test set* is reserved for.
  - **When even the safety ceiling can't fit the budget, the plan says so
    honestly rather than lying smaller.** At `best`=4–6 the ceiling and the
    starting size are the same number — there is no room to grow at all — and
    the card still shows ~70–94 min. That is correct, not a residual bug: a
    genuinely low best means a full century genuinely takes that long, and the
    honest answer is what tells him to work the number up, not a comforting
    one that contradicts its own sets/rest instructions.
  - Measured, `best`=9 (matching what he reported almost exactly): setSize 5→7,
    sets 20→15, **57 min → 44 min**. `best`=10: setSize 5→8, sets 20→13,
    **57 min → 38 min**. `best`=20 (already fits): unchanged at 30 min.
  - **Byte-identical to baseline on all 7 case-study scenarios**, and correctly
    so: `centuryDefaultMins()` — the number that actually feeds `dayTemplate`'s
    lunch/evening budgeting — was ALREADY capped at 40 before this fix, so for
    any `best` where the new pacing still lands ≥40 the budget-relevant number
    is unchanged; the harness's fabricated centuries all carry a measured
    `timedMins`, so after the first one `centuryMins()` reads the measured
    median and never touches `centurySetPlan()` at all. This fix is scoped
    entirely to the advisory Pacing text, which the generator has never read.
- **"No bar today" (2026-08-19, `noBarLog` / `weekDateForDow`)** — Sam: *"let's
  make it so I can say I don't have a pull up bar available today to do the
  century."* Closes a real gap: century ELIGIBILITY had only ever asked "is a
  session available that day", never "does that session have a bar to hang
  from" — none of the equipment presets without `pullup_bar` (`hotel_gym`,
  `bodyweight`) were ever excluded either, so a travel day could already have
  been scheduling 100 pull-ups with nothing to do them on.
  - **Keyed by DATE, not day-of-week or a recurring cfg toggle.** This is a
    one-off statement about today, not a preference — a flag that silently
    reapplied itself the same day next week would be its own bug. Same
    distinction the Century's own `offSession` flag makes for one-off vs.
    recurring. `weekDateForDow(dow)` is the Monday-anchored arithmetic
    `genProgram`'s own local `dateForDow` uses, hoisted to module scope because
    `centuryEligibleDow` needs it outside that closure.
  - **One check, in `centuryEligibleDow`, so every downstream consumer inherits
    it for free** — `centuryDows`, `centuryHostSession`, `centuryChargeFor`,
    `lunchBudget`/`eveningLifts`'s century charge, `sessionPlan`'s century line,
    `centuryOnlyDow`'s dashboard label. No second place had to learn about this.
  - **The greedy fill in `centuryDows` naturally substitutes a different day**
    when today drops out — verified: flagging an actual Tuesday century day (on
    a schedule with Tue/Thu/Sat availability) moved the week's centuries to
    Mon/Thu/Sat rather than just losing one. On a schedule with no substitute
    day available, the week simply runs one century short — no different from
    any other day that fails `centuryEligibleDow`.
  - **A day that silently drops out of the schedule looks like the app forgot,
    not like it heard him** — the same lesson the Fundamentals-card removal note
    already states. So when today would have hosted a century and the flag is
    the ONLY reason it isn't, `centuryHTML` shows a small "🚫 No bar today —
    Century skipped" card with an Undo button, rather than just returning `''`
    the way a day that was never eligible does.
  - The toggle itself (`🚫 No pull-up bar today — skip it`) sits next to the
    existing `century-already-done` link, same visibility rule: only offered
    before he's logged a single set today, since flagging it once sets are
    already banked doesn't mean anything.
  - Both the toggle and the undo call `replanCurrentWeek()` — the same call
    `century-when`'s toggle makes — because excluding or restoring a day changes
    which session hosts the century, the week's back/biceps MRV budget via
    `getCommittedVolumes`, and today's own lift count via `centuryChargeFor`.
  - **The freed time is real, and it has to go somewhere he can actually use.**
    Sam, immediately after: *"but if I skip it it also allows for more time to do
    other exercises."* Correct, and two things had to be true for that to hold:
    1. **The lift count has to rebuild, not be preserved.** `centuryChargeFor`
       drops to 0 the moment the day is ineligible, so `lunchBudget` /
       `eveningLifts` hand back a bigger limit — but `buildSession` PRESERVES any
       day whose `tk` matches the previous plan, and `tk` carried the muscle set,
       the foundation stamp and the hinge rescue and **not the slot count**. It
       happened to rebuild anyway because the muscle set usually shifts with the
       limit, which is luck, not a guarantee. `tk` now carries `+n:<slots>`, for
       exactly the reason the foundation stamp is in there. Measured: 0 of 7
       case-study scenarios changed (it is a no-op on a stable week), and 10 of
       10 flagged century days convert the freed minutes into an extra lift.
       This is GENERAL, not century-specific — every input to the time budget
       (a finisher toggled off, the calf top-up banked, century reps logged
       mid-day shrinking `centuryBudgetToday`) had the same latent gap.
    2. **The freed slot must not be spent on another bar movement.** It was:
       measured over a sweep of flagged days, **3 of 11 programmed
       `weighted_pullups`** on a day he had just said had no bar — the feature
       correctly freeing 30 minutes and then spending them on the one thing he
       cannot do. `equipForDow(equipmentKey,dow)` now drops `pullup_bar` from a
       flagged day's equipment at every site that resolves it: `buildSession`
       (which covers `canPlaceFoundation`, `pickEx` and `pickBackfillEx` in one
       place, since all three take that array), `pickEveningExercises`,
       `pyramidEquip`, the Cindy prescription's bar check, and the in-session
       swap list. 3 → 0 after. The PRESET is deliberately untouched — the
       apartment gym still has a bar tomorrow; this is a property of the day.
    Knock-ons that fall out for free and are correct: the Pyramid's ×1 rung is
    pull-ups, so a flagged day resolves the ladder to four rungs, which the
    existing rule already refuses to PRESCRIBE (only offer); Cindy (5 pull-ups a
    round) stops being prescribed; and the day stops counting as
    conditioning-covered, so a finisher is offered again — which is right, since
    the reason it was suppressed was that 100 pull-ups already WAS the day's
    conditioning.
  - Storage mirrors `pushupLog` exactly (a plain `{date:true}` map, unbounded,
    no pruning — same accepted precedent): wired through both localStorage
    save/load and both cloud-sync merge points, local wins on conflict.
- `PYRAMID_LADDER` (2026-08-03): Tom Holland's Spider-Man ladder, taken as LOGIC
  not as a fixed prescription (Sam: "I don't have to do this exact workout every
  Monday, it just clearly works"). Climb rungs 1→peak then back down, each
  movement carrying a multiplier. The arithmetic is the whole reason it's a
  feature: up-and-back sums to **peak² reps per unit of multiplier**, so the
  session is (Σ mult) × peak² — at peak 10 with 1/2/3/4/5 that's exactly the
  original 100/200/300/400/500 = 1,500 reps. **ONE number sets the entire dose**,
  which is what makes it obey the self-scaling rule: `pyramidPeak()` is the
  MINIMUM of a strength ceiling and a capacity ceiling (see the 2026-08-19 entry
  below), so the top rung stays 2 reps clear of failure (the same rule the
  Century runs on) AND stays a ladder he can actually finish. The ladder never
  needs rewriting as he improves. No history at all → peak 6 (540 reps).
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
  - Never a lunch: high-sweat and (at any peak worth doing) far past 40 min, so
    it fails both lunch constraints. The card says so in words on a lunch-only
    day rather than vanishing.
  - **The 400-sit-up rung is the one part flagged to Sam as questionable** —
    high-rep loaded lumbar flexion against a stated lower-back history. Left in
    (it's the prescription, it's not on his avoid list, and the core cycle
    already includes `flexion`), with the concern written into the movement's cue
    and a documented swap path via the avoid list.
  - Draft state `S.pyramid` = `{date,rung,startedAt,touchedAt}` — `rung` counts
    COMPLETED rungs, matching how the session is actually run. Cloud-synced by
    the shared `mergeStampedDraft` (see the Century's note on why
    `SINGLETON_FIELDS` and `unionById` both fail for session drafts).
- **Pyramid timing + a peak that scales to what he can FINISH (2026-08-19)** —
  Sam: *"I only made my way up the pyramid on Saturday and it took me longer than
  it said it would take to go up and down. Fix the timing estimate of that and
  scale the rung based on my current fitness level."* Both halves were real, and
  a third bug fell out on the way.
  - **The estimate was out by at least 1.8×, and the cause was structural, not a
    fudge factor.** `PYRAMID_SECS_PER_REP=1.5` plus `PYRAMID_REST_SECS` charged
    once per rung boundary. But **a rung is not one movement, it is FIVE** — bar,
    dip station, floor, floor, floor — so an 11-rung ladder has **44 changeovers
    INSIDE rungs that were charged nothing**, against the 10 boundaries that were
    charged. At peak 10 it is 76 uncounted against 18. On the small rungs (rung 1
    is one pull-up and five squats) the changeover IS the rung. Second error:
    one flat rate for five movements — a dead-hang pull-up is not an air squat.
    Now `pyramidModelSecs(blocks,rungs)` = Σ(reps × per-movement `secsPerRep`) +
    `rungs × (moves−1) × PYRAMID_CHANGEOVER_SECS`(=20) + `(rungs−1) × 45`.
    Deliberately NOT `TRANSITION_BUFFER_SECS`(45): that prices whole session
    BLOCKS moving between rooms and kit, not a step from the floor to the bar
    you are standing under.
    Measured: peak 6 goes **21 → 41 min**, and the climb alone — what he actually
    did — prices at **23 min**, which is what he reported beating. peak 10 (the
    original 1,500-rep prescription) is **51 → 91 min**, so the old
    `PYRAMID_MAX_PEAK` comment claiming it "stops fitting an hour" was arithmetic
    that never held.
  - **Partials now calibrate the estimate, and this is done BETTER than the
    Century manages.** The old `pyramidPlan` medianed COMPLETED sessions only,
    arguing a stopped session "says nothing about how long the whole thing
    takes" — the exact reasoning `centuryMins` carried until 2026-08-17, wrong
    the same way. Sam's only pyramid to date is a partial, so the app would have
    quoted him the unmeasured default forever. The Century has to extrapolate a
    partial pro-rata and then floor it (pro-rata understates); this doesn't
    extrapolate **at all** — `pyramidPaceFactor()` prices the portion he ACTUALLY
    did through the same model, compares it to the clock, and keeps the RATIO.
    No guessing about the part that never happened, and because it is a ratio it
    **transfers across peaks**, so a session logged at peak 6 still calibrates a
    peak-4 ladder. Guards mirror the Century's: `PYRAMID_MIN_CALIBRATION_MINS`
    (too small to learn from) and `PYRAMID_PACE_CLAMP` (one bad reading must not
    run away — the Century clamps the ANSWER, this clamps the CORRECTION).
  - **`pyramidPeak()` is now `min(strength, capacity)`.** The Century's best
    unbroken set is the right CEILING — the top rung is one unbroken set of that
    many pull-ups — but it is *only* a ceiling, and says nothing about whether
    15×peak² reps across five movements is completable. Pull-up strength and work
    capacity are different qualities and the ladder demands both.
    `pyramidCapacityPeak()` reads the last logged ladder: **stopped short** → he
    did `units` of peak², so the ladder he'd have finished has peak `√units`;
    **finished** → banked, next one is one rung taller (completing it IS the
    test, exactly as a Century's test set is). The most recent session governs
    rather than a rolling window — pyramids are occasional and responsiveness is
    the whole ask; it oscillates onto his real capacity within a couple of
    sessions. `PYRAMID_MIN_PEAK` **5 → 4** because a floor of 5 would have
    blocked the conclusion his own data points at (21 units → peak 4), and a
    self-scaling rule that cannot reach the answer is not self-scaling.
    His Saturday (peak 6, 6 of 11 rungs) resolves to **peak 4, ~29 min** — a
    ladder he finishes, which then steps back up 4 → 5 → 6 → 7 as he does.
  - **A THIRD bug, found while testing and pre-existing: the Pyramid was never
    prescribed on a weekend.** `pyramidEveSlot()` read `.eve` unconditionally,
    but **Saturday and Sunday store the session FLAT** (`{on,mins,loc,equipment}`
    directly on the day) — the shape `genProgram`'s own slot builder, plus
    `centuryHostSession` and `trainingDayCount`, already key on. So it returned
    `{}` every weekend and `pyramidPrescription` bailed at `if(!eve.on)` — on
    precisely the days "no barbell and plenty of time" describes best, and the
    day he actually ran it. Worse, `pyramidGymKey()` fell through to its
    apartment_gym default regardless of where he was, so the ladder resolved its
    `options` against the WRONG equipment: a bodyweight-only Saturday still got
    the pull-up rung it had no bar for — the exact "prescribing something that
    can't be done" failure that `options` list exists to prevent. Fixed, and
    `pyramidEveMins()` now prefers the slot's own `mins` (what `genProgram`
    builds from) over `getEveningMins()`'s fall-through to the generic
    `S.cfg.mins`, which on a weekend is the only place the length is recorded.
  - Consequence worth knowing, and it is honest rather than a regression: at
    **peak 10 the ladder needs 97 min including spine work, so it is never
    PRESCRIBED** even on a 90-minute evening. It is still offered as a card. The
    full Spider-Man ladder genuinely does not fit an evening; the old estimate
    only said it did because it wasn't counting 76 changeovers.
  - Verified: all 7 case-study scenarios **byte-identical** to baseline — the
    generator has never known about this session (`dayTemplate` knows nothing
    about it), which is exactly what that identity proves.
- **Editing a log had to survive the cloud merge** (2026-08-05, `pickNewerEdit` /
  `stampLogEdit`). `unionById` keeps the CLOUD copy for any id present on both
  sides, which is right for collections that are only appended to and wrong for
  logs, which have an edit screen. Symptom: "the adjust pull up time is not
  saving when i refresh the page" — the localStorage write was fine, and the
  merge put the stale row back over it. Same shape as the `mergeStampedDraft`
  note (a rule that can't express DELETION can't merge a list with an undo
  button; a rule that can't express MODIFICATION can't merge a list with an edit
  button) and the same fix: an `editedAt` stamp, newer wins whole.
  **This was never century-specific** — every field of Edit Workout was affected
  (weights, reps, added/removed exercises, retimed sessions); the century's time
  is just the first edited value that feeds a visible downstream number.
  Two things to know before touching this:
  - **Both unions need the resolver.** `loadFromCloud`'s is the obvious one;
    `saveToCloud`'s read-merge is the one that does the damage, because `save()`
    calls it immediately and the edit is clobbered before it ever leaves the
    device. Fixing only one looks like it works until the 60s read throttle
    lapses.
  - **Any new path that mutates a log in place must call `stampLogEdit`**, or
    the change silently reverts on the next sync. Appending a new log doesn't
    need it (no id collision). Deletion is already covered separately, by
    `filterTombstoned` against `deletedSessions`.
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
- **A century lunch is a DIFFERENT session, not a shorter one** (2026-08-19). Sam,
  looking at the plan: *"on pull up century lunch days, looks like we just have to
  get rid of all exercises and do abbreviated stretching to fit it in 40 min."*
  Correct, and the app was doing something worse than that. `LUNCH_LEDGER.minLifts`
  forced one lift onto every lunch — its comment read "a century day never becomes
  a no-lifting day", written when a century was budgeted at 16–20 min. At the
  MEASURED ~30 that sentence is arithmetically false: the ledger came back with one
  lift, `sessionPlan` then couldn't fit it, and SHED_ORDER dropped **the century** —
  the only thing the day exists for — leaving 21 of 40 minutes unused.
  - **`minLifts` is waived when the lunch hosts the century** (`hostsCentury`), so
    the answer can be ZERO. Prep drops to `PREP_BUDGET_MINS.centuryLunch`(=4) and
    the spine holds come off the box entirely, listed `deferred` with
    `byDesign:true` the way the Big 3 already was. Result: 4 prep + ~30 century +
    2 transitions = 36 of 40, and the century is never shed.
  - **`buildSession` returns null on `limit<=0`.** An empty session object would
    reach the dashboard and `startWorkout` with no exercise 0. `centuryOnlyDow()`
    then labels that day **🎯 Century Day** instead of "Rest Day 😴", so a day the
    app deliberately left unprogrammed doesn't read as one it forgot.
  - **The abbreviated warm-up lives on the century card** (`centuryPrepHTML`),
    because on that kind of day there is no workout screen to put it on. Same pools
    and same budgeting as the pre-lift prep, at the reduced cap and with
    `upperFirst` — blocks are dealt round-robin, so at 4 minutes ORDER decides what
    he actually gets, and 100 pull-ups means the shoulder and upper-back blocks go
    first. Never zero: a cold shoulder under 100 overhead pulls is the one thing
    worth spending scarce minutes on.
  - **`genProgram`'s Pass 2 now keys on whether a lunch session was BUILT**, not on
    lunch availability. A lunch that came back empty leaves the evening as the day's
    PRIMARY session; Pass 3 would have refused it as a "bonus" and the day would
    have lost its lifting entirely. This is what makes `centuryWhen:'lunch'` on a
    lunch+evening day work: lunch = the hundred, evening = the session.
  - **`CENTURY_KEEP_LIFTING_DAYS`(=3) is the second cap on `centuryDows`.** The
    existing rule only guaranteed ONE century-free day, which was enough while a
    century left room for a lift. Once it doesn't, the flat cap of 3 turned a
    five-day lunch week into 300 pull-ups plus **two** lifting sessions (measured:
    50 sessions → 20 over 10 weeks). The protocol's own range is "2–3× a week", so
    the low end is free: spend it and keep three days that lift. Measured after:
    lunch-only goes to 2 centuries (Tue/Thu, his preferred days) + 3 lifting days.
    Days whose host is an EVENING never count against it — those keep their
    lifting, one exercise lighter — so **S2, the full schedule, is byte-identical.**
  - **Asking that question without recursion took two seams.**
    `centuryDows → centuryCrowdsOutLifting → lunchBudget → centuryChargeFor →
    centuryHostSession → centuryDows` is a cycle, so (a) `centuryHostFor` is the
    host lookup WITHOUT the centuryDows guard, and (b) `lunchBudget` takes a
    `centuryOverride` — "what would this lunch afford IF it hosted the hundred" —
    which also short-circuits the finisher gate, the other centuryDows call inside
    that function. The point of the override is that the answer still comes from
    the ONE ledger instead of a second copy of its arithmetic.
  - Accepted cost, measured not assumed: on lunch-only the horizontal and rear-delt
    mandates go from 1-of-7 and 1-of-1 landed to 0-of-2 and 0-of-3 over ten weeks.
    Lunch-only weeks are already documented as structurally under-band and the back
    accents already capped there; three fewer lunch slots is the direct cause.
- `sessionPlan` / `TRANSITION_BUFFER_SECS` / `mcgillMins` (2026-08-18): Sam asked
  for the WHOLE routine — century, Big 3, stretching, spine holds, finisher —
  scheduled inside the one session that starts when he opens it, with the century
  and Big 3 timed from his own medians and a fixed buffer between movements. So
  the session is now itemised by ONE function that both the ledgers and the
  workout screen read: `sessionPlan` returns `{items,deferred,total,over,spare}`
  and renders as the "This session · N min of M" card above exercise 1.
  - **The ledgers size the lifting FROM it, so `lifts` is an input, not an
    output** — computing it inside would be circular. `eveningLifts` and
    `lunchBudget` decide the count, then hand it back in for display.
  - **`mcgillMins()` is the median of the last 5 TIMED Big 3 logs**, exactly like
    `centuryMins()`, falling back to `prepBlockMins(MCGILL_BIG3)` when there is
    no history — an unmeasured session must never poison the median, which is
    why `mcgill-done` writes `timedMins` separately from `duration` and
    `mcgillLogs()` filters on `timedMins>0`. The Big 3 log carries
    `isCardio:true` with an empty `exercises` array, so it is invisible to
    session bookkeeping the way the century log is.
  - **SHED_ORDER is the priority contract, and `eveningLifts` must agree with
    it.** Order is cool-down → Big 3 → spine holds → century, i.e. LIFTING
    OUTRANKS all the floor work, because that work needs no gym and a lift does.
    So `eveningLifts` charges only the pieces that can never be shed — prep, the
    century when this evening hosts it, the finisher, and the transition buffer.
    Charging the sheddable three as well was the two halves disagreeing with each
    other, and it showed: a 60-minute evening was billed 16 minutes for blocks
    the plan then deferred anyway and came out at ONE lift with six minutes
    spare.
  - **The century is the exception in SHED_ORDER**: it is last, and when it does
    reach the front the card says the day is TOO SHORT for it rather than
    pretending it was skipped — a ~30 min century cannot fit a 45-min evening
    alongside prep and a lift, and that is a scheduling answer, not a trim.
  - **The Big 3 still is NOT on the lunch ledger.** Same arithmetic MCGILL_BIG3
    already records: six minutes is a whole lift out of a 40-minute box. It is
    listed on a lunch plan as `deferred` with `byDesign:true` so the card says
    "morning or evening" instead of "didn't fit today". If it ever DOES move into
    the box, `LUNCH_LEDGER.spineMins` moves with it.
  - **The transition buffer is charged at two different counts on purpose.**
    `sessionPlan` bills `transitionMins(kept.length)` — what the session actually
    costs. `eveningLifts` bills `transitionMins(4)`, the pieces guaranteed to be
    there; reserving for all six cost a lift at 75 and 90 minutes, for buffer
    between blocks that get shed anyway.
  - Measured against `git show d42d3e2:index.html` on lunch+3-evening
    availability: **a 45-min evening goes 2 lifts → 1 and a 60-min evening 3 →
    2**; 75 and 90 are unchanged, century evenings gain one at 75/90, and lunch
    is unchanged at 2. That drop is the point, not a regression — prep (12) plus
    a finisher (~10) plus 12 min/lift genuinely does not leave room for a third
    lift in an hour, and the old tier lookup was promising one.
  - The in-session Century card and the plan's century line are both gated on
    `centuryHostSession`, not on `centuryDows` — one session a day pays for the
    hundred and one session a day shows it.
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

## The recovery monitor must use the engine's own predicates (2026-08-17)

`getRecoveryAdvisories` is the read-only banner on the dashboard, and it was
firing on plans the generator had deliberately and correctly made: *"Legs is set
for Fri & Sat — under the 72h it needs to recover"*, standing there **24 days out
of 42** on the main schedule and **every one a false alarm**. Two disagreements
with the scheduler, both in that one function:

1. It ignored the **weighted-only legs rule**. Friday's leg work was
   `pistol_squat` — bodyweight, `noWeight` — which by design does not reset the
   leg clock (`countsForRecoveryLog`). It counted it anyway.
2. It quoted the flat 72h from `MUSCLE_LOCKOUT_HOURS` while the scheduler has run
   **split leg windows** since 2026-08-03 (72h heavy / 48h accent, `legsRecovered`
   + `LEG_LIGHT_LOCKOUT`). The number in the warning wasn't the rule the plan was
   built on.

Both predicates are shared with the engine now, so a future change to the leg
windows follows automatically. Leg advisories 24 → 0 on lunch+3-evening and 7 → 0
on lunch-only; only the (pre-existing) 6-days-in-a-row streak notice remains.
**A monitor that fires on correct plans is worse than no monitor** — it trains you
to scroll past the banner, and the banner is the only thing that will ever report
a real collision.

**KNOWN GAP, left in deliberately:** this function has never looked at planned
EVENING sessions (`day.eveningSession`), so on a lunch+evening schedule it sees
half the week. Adding them was tried and measured — ~20 more advisory-days over 6
weeks, and every one checked was a TRUE positive (`arnold_press` Tue evening then
`seated_db_press` Wed lunch, ~18h; `weighted_pullups` Thu evening then again
Friday lunch). They are collisions the generator makes ON PURPOSE:
`getLockedMuscles` pins a locked muscle's MRV ceiling rather than banning it, and
the Foundation Five guarantee bypasses the caps outright. Warning daily about
something "space them out" can't fix is the same failure this pass just removed
for legs, so it stays off until the underlying scheduling question is settled.

## OFF-RAIL — the visual base direction (2026-09-03)

Sam asked for asymmetry, unusual negative space and grid breaks, then for the
result to become one consolidated "base direction" applied to every route, with
"the exact same typography, card styles and aesthetic language" so the app reads
as one thing. It is a **single CSS layer** at the end of the `<style>` block plus
a handful of markup edits — the scheduler, the ledgers and the estimator are
untouched, and the case-study harness proves it: all 7 scenarios are
**byte-identical to `git show HEAD:index.html` through the same harness** (the
committed `analysis/case-study-data.json` is STALE and differs from both — the
meaningful comparison is a fresh baseline run, not that file).

Ten named components, `OR-1`…`OR-13`, each documented in place and each
independently removable — the header block in `index.html` lists them. What
matters here is the reasoning that isn't obvious from the CSS:

- **The route class is `.rag`, not a per-view class.** Every browsing route
  (`v-dash`/`v-program`/`v-history`/`v-plan`/`v-build`/`v-mrv`/`v-page`) carries
  `view rag <route>`; the shared language keys off `.rag` and only the few
  genuinely view-specific pieces key off the route class. Writing the ragged
  rules as a seven-way selector list was the alternative, and it guarantees the
  seven drift apart the first time one is edited.
- **The in-session workout screen deliberately has NO `.rag`.** It keeps OR-4
  (corners) and OR-10 (reveals) so it is visibly the same application, and opts
  out of the rail, the bleeds and the uneven rhythm. Mid-set, a card edge running
  off-screen and an irregular gap are cost, not character. The render smoke test
  asserts this both ways — `renderWorkout()` must contain `class='view'` and must
  NOT contain `class='view rag`.
- **Buttons and labels are excluded from the bleed** (`:not(.btn,.sec-lbl,…)`).
  A tap target that runs off the right edge is a worse button, and a label that
  drifts from what it labels reads as a bug rather than a decision. The exclusion
  list is the reason the raggedness looks intentional.
- **OR-3's `nth-child` pattern is deterministic but content-blind**, and that is
  the point: which blocks indent and which bleed depends on how many cards the
  day produced, so the page rags differently on a century day than on a lifting
  day without anything computing that.
- **OR-9 replaced two DEAD rules, and this is the CSS twin of the EX-ordering
  trap.** The first pass styled `.plan-days` and `.opts`: `.plan-days` has no
  markup anywhere in the app, and `.opts` renders only in the setup flow and the
  fatigue-rating card — neither of which has a `.v-plan`/`.v-build` ancestor. **A
  grid break aimed at a selector that never matches looks identical to one that
  works.** Caught by asserting on rendered output, not by reading the CSS. The
  rules that replaced them (`.plan-slot-checks`, and the set list's weight/reps
  split going 1fr/1fr → 1.18fr/.82fr) both demonstrably render.
- **`.sets-hdr` and `.set-row` must be changed in ONE declaration.** They share
  the same `${rowGrid}` inline override, so a CSS change to only one of them puts
  the header out of alignment with its own numbers on every weighted lift.
- **The `--w` custom property is what makes the reveal possible.** The volume
  bars used to carry `width:${pct}%` inline, which beats any class rule — the
  reveal could hold it at 0 and the bar would simply never animate. The length
  now rides `--w` and the `.reveal`/`.reveal.in` pair owns `width`.
- **`armReveals` is armed by a MutationObserver on `#root`'s child list**, not
  from inside `render()`. The app replaces `#root` wholesale on every state
  change, so anything observed before a render is a detached node; the observer
  catches every path (`render()`, the cloud-sync re-render, an undo) without
  `render()` needing to know the reveal exists. It fires **once per element** —
  a chart that re-animates every time you scroll past stops reading as data —
  and falls back to showing everything at full length where
  `IntersectionObserver` is missing, because the reveal is polish and the data
  is not.
- **A real bug this pass introduced and fixed**: `.wkt-prog` set as a
  wide-tracked caps label is WIDER than the sentence case it replaced, and
  `.wkt-hdr` is a space-between flex row with a long day name beside two
  buttons — **Quit was pushed off the right edge**, on the one screen you cannot
  leave any other way. Fixed with an explicit shrink/no-shrink split rather than
  by shrinking the type back.
- **The rag scales with the screen** (`@media (max-width:380px)`). At 360px a
  28px indent plus an 18px bleed spends 13% of the width and the hero card wraps
  mid-phrase. Everything scales together; nothing is switched off.
- `:not()` with a **selector list** is Level 4 (Chrome 88+, Safari 16.4+). On
  anything older the whole rule is dropped and the cards fall back to their own
  margins — a graceful loss of the rag, not a broken screen.

Verified: the syntax gate, an **18-assertion render smoke test** over every route
(both bento states, the `.rag` opt-out, no `undefined`/`NaN`/`[object Object]`
in any output), the case-study harness against a fresh HEAD baseline, and live
screenshots of every route at 440px and 360px. **Re-run the render smoke test
after touching `renderDash`, `renderMRVWidget` or `renderMRVBreakdown`** — the
bento and the `--w` bars are interpolated identifiers, and a ReferenceError
inside a template literal is invisible to the syntax check.

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
  hands to one bar or cues a deep bottom stretch.
  **`floor_press` is DUMBBELL-ONLY as of 2026-08-17** (Sam: "barbell plates will
  hit ground before my arms"). That mechanical stop is the entire reason it leads
  the block, and with a barbell the plates land first — the bar halts several
  inches high, the triceps never touch down, and the one guarantee the movement
  exists to provide silently stops being enforced. Dropping `'barbell'` from `eq`
  costs nothing in availability (every preset carrying a barbell also carries
  dumbbells) and fixes the weight unit for free: the estimator and the weight
  inputs read `eq.includes('dumbbells')&&!eq.includes('barbell')` to choose
  between "lb" and "lb ea", and it had been showing a total. Renamed to
  **DB Floor Press** so the prescription can't be misread on the bar. **This has never been
  assessed** — the pattern (a pop under a violent swing, still symptomatic
  years later on two specific loaded positions) is worth a physio's opinion,
  and the app changes are load management, not treatment.
- Lower back: **any standing overhead press hurts** (2026-07-27, expanded from
  the push-press-only report). `ohp`, `push_press`, `db_push_press`, and
  `thrusters` are all on `avoidExercises`. Seated overhead pressing
  (`seated_db_press`, `arnold_press`) is fine and keeps the shoulders pool
  supplied with a compound. Don't add new standing overhead press variants
  (jerks, standing landmine/Z-press, overhead carries under load) **the way
  the first four were handled** — `avoidExercises` hides a movement from the
  swap list too, not just the generator.
  - **`db_hang_clean_jerk` (2026-08-31)** is the one deliberate exception, and
    it's handled differently on purpose. Sam asked for it by name, was shown
    this exact constraint, and chose: add it for real, keep it out of anything
    the generator reaches for on its own, but leave it pickable from the swap
    list and Build My Own Workout rather than hidden the way `avoidExercises`
    would hide it. New flag `standingPressRisk:true` does that — checked
    alongside `hipRisk`/`shoulderRisk` in `pickEx`'s `baseFor` and in
    `canPlaceFoundation`, but **unconditionally**, no caution toggle, matching
    how this constraint has always worked (the other four have never been
    toggle-gated either). Deliberately NOT reusing `shoulderRisk` even though
    Sam described it that way informally — `customExWarnings`' shoulder message
    is hardcoded to say "left shoulder," which would be actively wrong here;
    `standingPressRisk` gets its own warning line naming the real reason.
    Verified not auto-generated on any of the three schedule profiles, and
    reachable from both the swap list and Custom Session's name search. All 7
    case-study scenarios byte-identical to baseline — it can never be selected
    by anything the generator touches, so there's nothing for the sim to see
    move.
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
