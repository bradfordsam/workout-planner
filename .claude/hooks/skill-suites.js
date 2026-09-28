#!/usr/bin/env node
'use strict';
// PreToolUse hook: remind the agent to run the installed skill suites whenever
// this app's CODE is edited. Wired up in .claude/settings.json.
//
// Written in Node, not a shell one-liner, for two reasons:
//   1. `jq` is NOT installed on this machine (checked 2026-09-28). Every hook
//      example in the docs pipes through jq, and a hook whose command is not
//      found fails silently — the exact invisible-dead-code failure this repo's
//      CLAUDE.md keeps running into.
//   2. Node IS installed (v24) and this repo already gates its deploys on it,
//      so there is no new dependency here.
//
// NEVER BLOCKS. Every path exits 0, and any unexpected error exits 0 printing
// nothing. Pushing to main deploys the live site Sam uses mid-workout; a broken
// reminder must not be able to stop him editing it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FULL = `<EXTREMELY_IMPORTANT>
You are editing the workout-planner app. Sam has asked that the installed skill
suites drive this work. Invoke them with the Skill tool — do not just recall
them from memory.

SUPERPOWERS — the workflow gates:
  • superpowers:brainstorming            BEFORE building any feature or behaviour change
  • superpowers:test-driven-development  before writing implementation code
  • superpowers:systematic-debugging     for any bug, failure, or surprise — before proposing a fix
  • superpowers:verification-before-completion  before claiming ANYTHING works, is fixed, or passes
  • superpowers:requesting-code-review   before landing a feature
  • superpowers:writing-plans             when the task is multi-step

GSTACK — review, QA and landing:
  • gstack                    router; use it to pick the right gstack skill
  • gstack-review             pre-landing diff review
  • gstack-qa                 drive the real app in a browser and fix what breaks
  • gstack-investigate        root-cause debugging
  • gstack-land-and-deploy    the ship workflow

IMPECCABLE — all UI work:
  • impeccable:impeccable     ANY visual or UI change. In this app the UI lives in
    the same index.html as the logic: the <style> block (including the OFF-RAIL
    layer at its end) and the render* functions. If you are touching layout,
    spacing, type, color, hierarchy, motion, or a card's markup, that is
    impeccable's job, not freehand CSS.

THIS REPO'S OWN GATES STILL APPLY AND ARE NOT OPTIONAL (see CLAUDE.md):
  pushing to main IS deploying to production. Before any push:
  syntax check → node analysis/render-smoke.js → node analysis/case-study.js
  (+ the 3-profile balance sim if dayTemplate, MRV pricing or the lunch ledger
  is touched), then restore the case-study data files.
</EXTREMELY_IMPORTANT>`;

const BRIEF =
  'Reminder: skill suites apply to this edit — superpowers (brainstorming / TDD / ' +
  'verification-before-completion), gstack (review / QA), impeccable (any UI or ' +
  '<style> change). CLAUDE.md deploy gates are still mandatory before pushing.';

// Emit and exit. `event` must match the hook event or Claude Code drops it.
function emit(event, text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })
  );
  process.exit(0);
}

try {
  const raw = fs.readFileSync(0, 'utf8');
  if (!raw.trim()) process.exit(0);
  const input = JSON.parse(raw);

  // ── SessionStart --resume ─────────────────────────────────────────────────
  // The superpowers plugin injects its using-superpowers skill on
  // `startup|clear|compact` but NOT on `resume` (verified in
  // ~/.claude/plugins/.../superpowers/6.4.2/hooks/hooks.json). So a resumed
  // session silently starts with none of the suites loaded — which is exactly
  // what happened in the session that asked for this. This closes that gap for
  // this project.
  if (process.argv[2] === '--session-start') emit('SessionStart', FULL);

  const fp = String(
    (input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path)) || ''
  );
  if (!fp) process.exit(0);

  // Only the app's own source. Deliberately narrow: the reminder is noise on a
  // markdown edit, on .claude/ config, and on the scratchpad scripts the verify
  // harnesses get written to.
  const norm = fp.replace(/\\/g, '/');
  const base = path.posix.basename(norm);
  const isAppCode =
    base === 'index.html' ||
    base === 'sw.js' ||
    base === 'manifest.json' ||
    /\/analysis\/[^/]+\.js$/.test(norm);
  if (!isAppCode) process.exit(0);
  // A scratchpad copy of index.html is not the app.
  if (/\/(scratchpad|Temp|tmp)\//i.test(norm)) process.exit(0);

  // Full block once per session, short line after. Firing the whole thing before
  // all ~25 edits of a working session would bury the work it is meant to guide;
  // a one-liner still fires on every edit, which is what was asked for.
  let first = true;
  const sid = String(input.session_id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (sid) {
    const marker = path.join(os.tmpdir(), `wp-skill-suites-${sid}`);
    try {
      // 'wx' fails if it already exists — one atomic check-and-set, no race.
      fs.writeFileSync(marker, '1', { flag: 'wx' });
    } catch (e) {
      first = false;
    }
  }

  emit('PreToolUse', first ? FULL : BRIEF);
} catch (e) {
  // Never block an edit to the live app.
}
process.exit(0);
