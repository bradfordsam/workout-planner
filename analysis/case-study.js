#!/usr/bin/env node
'use strict';
// Case-study harness: runs the app's real program generator headlessly and
// measures muscle-group balance + goal alignment over simulated training blocks.
//
// Usage:
//   node analysis/case-study.js            run all scenarios, write data + report
//   node analysis/case-study.js --smoke    load the app context and generate one week
//
// The app code is extracted verbatim from index.html and evaluated in a vm
// sandbox with a mocked clock (SimDate). Nothing here touches index.html,
// localStorage, or the cloud.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT_DATA = path.join(__dirname, 'case-study-data.json');
const WP3_PATH = path.join(__dirname, 'data', 'wp3.json');
const START_MONDAY = '2026-01-05'; // fixed Monday anchor → reproducible %3/%5 rotations
const WEEKS = 10;

// ─── App source extraction ───
const SRC = (() => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('script block not found in index.html');
  const cut = m[1].indexOf('// INIT');
  if (cut === -1) throw new Error('INIT sentinel not found — index.html structure changed');
  return m[1].slice(0, cut);
})();

// ─── Mock clock ───
let simNowMs = Date.parse(START_MONDAY + 'T08:00:00');
class SimDate extends Date {
  constructor(...a) { if (a.length === 0) super(simNowMs); else super(...a); }
  static now() { return simNowMs; }
}
function setSim(isoLocal) { simNowMs = new Date(isoLocal).getTime(); }

// ─── Host date helpers (mirror the app's local-day math) ───
const pad = (x) => String(x).padStart(2, '0');
function localDay(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDaysHost(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); }
function dowOf(iso) { return new Date(iso + 'T12:00:00').getDay(); }
function daysBetweenHost(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
function logDayHost(isoTs) { return localDay(new Date(isoTs)); }

// ─── pickEx / pickBackfillEx telemetry shim (runs inside the app context) ───
const TELEMETRY_SHIM = `
globalThis.__picks = [];
globalThis.__origPickEx = pickEx;
pickEx = function(slot, equip, used, isLunch, budget, freq){
  const e = __origPickEx(slot, equip, used, isLunch, budget, freq);
  __picks.push({
    slot: {muscle: slot.muscle, type: slot.type, tag: slot.tag || null, powerPreferred: !!slot.powerPreferred},
    isLunch: !!isLunch,
    picked: e ? {id: e.id, tags: e.tags || [], highSweat: !!e.highSweat, hipRisk: !!e.hipRisk} : null
  });
  return e;
};
globalThis.__origBackfill = pickBackfillEx;
pickBackfillEx = function(equip, used, isLunch, budget, exFreq, excludeMuscles){
  const e = __origBackfill(equip, used, isLunch, budget, exFreq, excludeMuscles);
  __picks.push({
    slot: {muscle: e ? e.muscle : null, type: null, tag: null, backfill: true},
    isLunch: !!isLunch,
    picked: e ? {id: e.id, tags: e.tags || [], highSweat: !!e.highSweat, hipRisk: !!e.hipRisk} : null
  });
  return e;
};
`;

// ─── Context factory ───
function freshContext() {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      visibilityState: 'hidden', body: {},
    },
    navigator: {},
    alert() {}, confirm: () => false, prompt: () => null,
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    fetch: () => Promise.reject(new Error('no network in sim')),
    location: { href: 'https://sim.local/', search: '', hash: '' },
    URLSearchParams,
    Date: SimDate,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx, { filename: 'app.js' });
  vm.runInContext(TELEMETRY_SHIM, ctx, { filename: 'telemetry-shim.js' });
  // Never let sim state try to leave the machine.
  vm.runInContext('saveToCloud = async function(){}; if (typeof pullFromCloudThrottled !== "undefined") pullFromCloudThrottled = function(){};', ctx);
  const get = (expr) => vm.runInContext(expr, ctx);
  return {
    ctx, sandbox, get,
    S: get('S'),
    EX: get('EX'),
    genProgram: get('genProgram'),
    getMRVLimits: get('getMRVLimits'),
    defaultAvailability: get('defaultAvailability'),
    MUSCLE_LOCKOUT_HOURS: get('MUSCLE_LOCKOUT_HOURS'),
    LEG_EMPHASIS_TAGS: get('LEG_EMPHASIS_TAGS.slice()'),
    LOG_KEEP: get('LOG_KEEP'),
  };
}

// ─── Log fabrication (exact finishWorkout shape, index.html:3068-3083) ───
function mkLog(dateStr, sess, isLunch, fatigue, id) {
  return {
    id,
    date: new Date(dateStr + (isLunch ? 'T12:30:00' : 'T18:00:00')).toISOString(),
    dayName: sess.name,
    isLunch,
    duration: isLunch ? 40 : (sess.mins || sess.sessionMins || 60),
    exercises: (sess.exercises || []).map((e) => ({
      id: e.id, name: e.name, muscle: e.muscle,
      sets: Array.from({ length: e.sets || 3 }, () => ({ weight: e.noWeight ? 0 : 50, reps: 8 })),
    })),
    fatigue: fatigue || null,
  };
}

// ─── Seeded PRNG for the missed-session scenario (app code stays deterministic) ───
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Availability builders ───
function avLunchOnly(app) { return app.defaultAvailability(); }
function avFullSchedule(app) {
  const av = app.defaultAvailability();
  av[2].eve = { on: true, mins: 60, loc: 'ymca', equipment: 'ymca' };
  av[4].eve = { on: true, mins: 60, loc: 'ymca', equipment: 'ymca' };
  av[6] = { on: true, mins: 60, loc: 'ymca', equipment: 'ymca' };
  return av;
}
function avEfficiency3Day(app) {
  const av = {};
  [1, 2, 3, 4, 5].forEach((dow) => {
    av[dow] = { lunch: false, eve: { on: [1, 3, 5].includes(dow), mins: 60, loc: 'ymca', equipment: 'ymca' } };
  });
  av[6] = { on: false, mins: 60, loc: 'ymca', equipment: 'ymca' };
  av[0] = { on: false, mins: 60, loc: 'ymca', equipment: 'ymca' };
  return av;
}

// ─── Scenario runner ───
function runScenario(sc) {
  const app = freshContext();
  const { S, sandbox } = app;
  const startMonday = sc.startMonday || START_MONDAY;
  setSim(startMonday + 'T08:00:00');

  S.view = 'dash';
  S.logs = [];
  S.program = null;
  S.sleepLog = {};
  S.weekPlan = { weekOf: null, availability: sc.availability(app), calGoal: null, recentWorkouts: '' };
  if (sc.seed) sc.seed(app);

  const rng = mulberry32(sc.skipSeed || 1234);
  const sessions = [];   // snapshots of every session actually taken
  const skipped = [];
  const restDays = [];
  const regenPicks = []; // per-regen pick telemetry, most recent last (sessions can be preserved across many regens)
  let dropPicks = [];    // slot picks that returned null (across all regens — replan-multiplied)
  let logId = 1;

  const regen = () => {
    sandbox.__picks.length = 0;
    S.program = app.genProgram(S.cfg, S.weekPlan.availability, S.logs);
    const picks = sandbox.__picks.slice();
    regenPicks.push(picks);
    if (regenPicks.length > 40) regenPicks.shift(); // a session survives at most a couple weeks of regens
    dropPicks.push(...picks.filter((p) => p.picked === null && p.slot.tag));
  };

  // Match each exercise of a taken session to its slot record from the most
  // recent regen (by picked id, preferring matching muscle). Preserved sessions
  // may predate the last regen — those exercises get slotTag null (counted as
  // "unattributed" rather than guessed).
  const snapshot = (dateStr, sess, isLunch) => {
    // Search pick telemetry newest-regen-first: preserved sessions were picked
    // in an older regen than the one that produced the current program.
    const findPick = (e, usedKeys) => {
      for (let r = regenPicks.length - 1; r >= 0; r--) {
        const pool = regenPicks[r].filter((p) => p.isLunch === isLunch && p.picked);
        let pi = pool.findIndex((p, i) => !usedKeys.has(r + ':' + i) && p.picked.id === e.id && p.slot.muscle === e.muscle);
        if (pi === -1) pi = pool.findIndex((p, i) => !usedKeys.has(r + ':' + i) && p.picked.id === e.id);
        if (pi !== -1) { usedKeys.add(r + ':' + pi); return pool[pi]; }
      }
      return null;
    };
    const usedKeys = new Set();
    const exs = (sess.exercises || []).map((e) => {
      const p = findPick(e, usedKeys);
      return {
        id: e.id, name: e.name, muscle: e.muscle, type: e.type, sets: e.sets || 3,
        tags: e.tags || [], highSweat: !!e.highSweat, hipRisk: !!e.hipRisk, noWeight: !!e.noWeight,
        slotTag: p ? p.slot.tag : undefined, slotBackfill: p ? !!p.slot.backfill : undefined,
      };
    });
    return {
      dateStr, week: Math.floor(daysBetweenHost(startMonday, dateStr) / 7),
      dow: dowOf(dateStr), isLunch, name: sess.name, desc: sess.desc || '', exercises: exs,
    };
  };

  const takeSession = (dateStr, sess, isLunch) => {
    sessions.push(snapshot(dateStr, sess, isLunch));
    S.logs.push(mkLog(dateStr, sess, isLunch, sc.fatigue ?? 2, String(logId++)));
    S.logs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (sc.logCap) S.logs = S.logs.slice(-sc.logCap);
    regen(); // finishWorkout → replanCurrentWeek (index.html:3081)
  };

  for (let d = 0; d < (sc.weeks || WEEKS) * 7; d++) {
    const dateStr = addDaysHost(startMonday, d);
    const dow = dowOf(dateStr);
    setSim(dateStr + 'T08:00:00');
    if (sc.sleepHours != null) S.sleepLog[dateStr] = sc.sleepHours;
    if (dow === 1) { S.weekPlan.weekOf = dateStr; regen(); }
    if (!S.program) regen();

    let day = S.program.week[dow];
    if (!day || day.rest) { restDays.push(dateStr); continue; }

    if (day.isLunch && day.exercises && day.exercises.length) {
      if (sc.skipRate && rng() < sc.skipRate) skipped.push({ dateStr, isLunch: true });
      else { setSim(dateStr + 'T12:30:00'); takeSession(dateStr, day, true); }
    }

    day = S.program.week[dow]; // re-read: the post-lunch regen may reshape the day
    let eve = null;
    if (day && !day.rest) eve = day.isLunch ? day.eveningSession : day;
    if (eve && eve.exercises && eve.exercises.length) {
      if (sc.skipRate && rng() < sc.skipRate) skipped.push({ dateStr, isLunch: false });
      else { setSim(dateStr + 'T18:00:00'); takeSession(dateStr, eve, false); }
    }
  }

  return computeMetrics(app, sc, { sessions, skipped, restDays, dropPicks, logs: S.logs, startMonday });
}

// ─── Metrics ───
const MUSCLES = ['legs', 'back', 'chest', 'shoulders', 'biceps', 'triceps', 'core'];
const CORE_TAGS = ['anti-rotation', 'rotation', 'flexion', 'anti-extension', 'lateral'];
const LEG_ACCENTS = ['power', 'eccentric', 'decel'];
const MANDATE_TAGS = ['strength', 'hinge', 'hamstring', 'horizontal', 'rear_delt'];

function computeMetrics(app, sc, run) {
  const { sessions, skipped, restDays, dropPicks, startMonday } = run;
  const EXbyId = new Map(app.EX.map((e) => [e.id, e]));
  const weeks = sc.weeks || WEEKS;

  // Base MRV bands with fatigue neutralized (stash logs so getFatiguedMuscles sees none).
  const stash = app.S.logs; app.S.logs = [];
  const bands = app.getMRVLimits();
  app.S.logs = stash;

  // 1. Volume balance: sets per (week, muscle) from taken sessions.
  const weekly = Array.from({ length: weeks }, () => Object.fromEntries(MUSCLES.map((m) => [m, 0])));
  sessions.forEach((s) => s.exercises.forEach((e) => {
    if (weekly[s.week] && weekly[s.week][e.muscle] !== undefined) weekly[s.week][e.muscle] += e.sets;
  }));
  const volume = {};
  MUSCLES.forEach((m) => {
    const vals = weekly.map((w) => w[m]);
    const steady = vals.slice(1); // week 0 = cold start, reported separately
    const band = bands[m] || { min: 0, max: 99 };
    const inBand = steady.filter((v) => v >= band.min && v <= band.max).length;
    const under = steady.filter((v) => v < band.min).length;
    const over = steady.filter((v) => v > band.max).length;
    volume[m] = {
      band, weekly: vals,
      week0: vals[0],
      mean: +(steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length)).toFixed(1),
      min: Math.min(...steady), max: Math.max(...steady),
      inBandPct: +(100 * inBand / steady.length).toFixed(0),
      underPct: +(100 * under / steady.length).toFixed(0),
      overPct: +(100 * over / steady.length).toFixed(0),
    };
  });
  const cells = MUSCLES.length * (weeks - 1);
  const inBandCells = MUSCLES.reduce((a, m) => a + Math.round(volume[m].inBandPct * (weeks - 1) / 100), 0);

  // 2. Lockout compliance: cross-day gaps per muscle vs MUSCLE_LOCKOUT_HOURS.
  const lockout = {};
  MUSCLES.forEach((m) => {
    // Weighted-only legs rule (index.html countsForRecovery*): bodyweight leg
    // work doesn't reset the legs clock, so it doesn't define a legs gap either.
    const counts = (e) => e.muscle === m && (m !== 'legs' || !e.noWeight);
    const dates = [...new Set(sessions.filter((s) => s.exercises.some(counts)).map((s) => s.dateStr))].sort();
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(daysBetweenHost(dates[i - 1], dates[i]) * 24);
    const lim = app.MUSCLE_LOCKOUT_HOURS[m] || 48;
    lockout[m] = {
      limitHrs: lim, trainingDays: dates.length,
      minGap: gaps.length ? Math.min(...gaps) : null,
      medianGap: gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null,
      violations: gaps.filter((g) => g < lim).length,
    };
  });

  // 3. Mandate fulfillment — outcome-based on taken sessions + slotTag attribution.
  const mandates = {};
  MANDATE_TAGS.forEach((t) => { mandates[t] = { slots: 0, fulfilled: 0, downgraded: 0 }; });
  sessions.forEach((s) => s.exercises.forEach((e) => {
    if (e.slotTag && MANDATE_TAGS.includes(e.slotTag)) {
      mandates[e.slotTag].slots++;
      if (e.tags.includes(e.slotTag)) mandates[e.slotTag].fulfilled++;
      else mandates[e.slotTag].downgraded++;
    }
  }));
  // Session-level outcome checks (independent of slot attribution).
  const eveLeg = sessions.filter((s) => !s.isLunch && s.exercises.some((e) => e.muscle === 'legs'));
  const lunchLeg = sessions.filter((s) => s.isLunch && s.exercises.some((e) => e.muscle === 'legs'));
  const twoLeg = sessions.filter((s) => s.exercises.filter((e) => e.muscle === 'legs').length >= 2);
  const backSess = sessions.filter((s) => s.exercises.some((e) => e.muscle === 'back'));
  const twoBack = sessions.filter((s) => s.exercises.filter((e) => e.muscle === 'back').length >= 2);
  const has = (s, muscle, tag) => s.exercises.some((e) => e.muscle === muscle && e.tags.includes(tag));
  const outcomes = {
    eveLegWithStrength: [eveLeg.filter((s) => has(s, 'legs', 'strength')).length, eveLeg.length],
    eveLegWithStrengthOrHinge: [eveLeg.filter((s) => has(s, 'legs', 'strength') || has(s, 'legs', 'hinge')).length, eveLeg.length],
    lunchLegWithHinge: [lunchLeg.filter((s) => has(s, 'legs', 'hinge')).length, lunchLeg.length],
    twoLegWithHamstring: [twoLeg.filter((s) => has(s, 'legs', 'hamstring')).length, twoLeg.length],
    backWithHorizontal: [backSess.filter((s) => has(s, 'back', 'horizontal')).length, backSess.length],
    twoBackWithRearDelt: [twoBack.filter((s) => has(s, 'back', 'rear_delt')).length, twoBack.length],
  };
  const mandateDrops = dropPicks.reduce((acc, p) => { acc[p.slot.tag] = (acc[p.slot.tag] || 0) + 1; return acc; }, {});

  // 4. Accent + core rotation.
  // Expressed accents only: the pickEx accent-softening tier can degrade an
  // accent slot to a plain compound (empty pool under avoid list/equipment) —
  // count a conversion only when the picked movement actually carries the tag.
  const accentPicks = [];
  sessions.filter((s) => !s.isLunch).forEach((s) => s.exercises.forEach((e) => {
    if (e.slotTag && LEG_ACCENTS.includes(e.slotTag) && e.muscle !== 'core' && e.tags.includes(e.slotTag)) accentPicks.push({ muscle: e.muscle, tag: e.slotTag });
  }));
  const legAccentDist = Object.fromEntries(LEG_ACCENTS.map((t) => [t, accentPicks.filter((p) => p.muscle === 'legs' && p.tag === t).length]));
  const accentByMuscle = accentPicks.reduce((a, p) => { a[p.muscle] = (a[p.muscle] || 0) + 1; return a; }, {});
  const coreDist = Object.fromEntries(CORE_TAGS.map((t) => [t, 0]));
  let coreExCount = 0, sessionsWithCore = 0;
  sessions.forEach((s) => {
    const cores = s.exercises.filter((e) => e.muscle === 'core');
    if (cores.length) sessionsWithCore++;
    cores.forEach((e) => {
      coreExCount++;
      const t = e.slotTag && CORE_TAGS.includes(e.slotTag) ? e.slotTag : CORE_TAGS.find((ct) => e.tags.includes(ct));
      if (t) coreDist[t]++;
    });
  });

  // 5. Variety / frequency cap.
  const instances = sessions.flatMap((s) => s.exercises.map((e) => ({ id: e.id, dateStr: s.dateStr })));
  const uniqueIds = new Set(instances.map((i) => i.id));
  const idCounts = {};
  instances.forEach((i) => { idCounts[i.id] = (idCounts[i.id] || 0) + 1; });
  const top5 = Object.entries(idCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => ({ id, name: (EXbyId.get(id) || {}).name || id, times: n }));
  // Rolling 7-day windows ending on each training date: count>2 = cap breach in what was TAKEN.
  const trainDates = [...new Set(sessions.map((s) => s.dateStr))].sort();
  let capViolations = 0;
  trainDates.forEach((d) => {
    const from = addDaysHost(d, -6);
    const windowCounts = {};
    instances.filter((i) => i.dateStr >= from && i.dateStr <= d).forEach((i) => { windowCounts[i.id] = (windowCounts[i.id] || 0) + 1; });
    capViolations += Object.values(windowCounts).filter((n) => n > 2).length;
  });

  // 6. Goal-alignment checklist.
  const lunchSessions = sessions.filter((s) => s.isLunch);
  const avoid = new Set(app.S.cfg.avoidExercises || []);
  const legAllow = new Set([...app.LEG_EMPHASIS_TAGS, 'hinge', 'hamstring']);
  const weeksWithStrength = new Set(sessions.filter((s) => s.exercises.some((e) => e.muscle === 'legs' && e.tags.includes('strength'))).map((s) => s.week));
  const goal = {
    heavyStrengthWeeks: [weeksWithStrength.size, weeks],
    lunchSetRule: [lunchSessions.filter((s) => s.exercises.slice(1).every((e) => e.sets <= 2)).length, lunchSessions.length],
    lunchHighSweat: lunchSessions.reduce((a, s) => a + s.exercises.filter((e) => e.highSweat).length, 0),
    hipRiskPicks: sessions.reduce((a, s) => a + s.exercises.filter((e) => e.hipRisk || e.tags.includes('plyometric')).length, 0),
    avoidListPicks: sessions.reduce((a, s) => a + s.exercises.filter((e) => avoid.has(e.id)).length, 0),
    legAllowlistBreaches: sessions.reduce((a, s) => a + s.exercises.filter((e) => e.muscle === 'legs' && !e.tags.some((t) => legAllow.has(t))).length, 0),
  };

  // 7. Structure.
  const relabeled = sessions.filter((s) => s.desc.startsWith('Accessory / recovery work')).length;
  const sessPerWeek = Array.from({ length: weeks }, (_, w) => sessions.filter((s) => s.week === w).length);

  return {
    name: sc.name, weeks, bands,
    totals: { sessions: sessions.length, skipped: skipped.length, restDays: restDays.length, relabeled, sessPerWeek },
    volume, headline: { inBandCells, cells, inBandPct: +(100 * inBandCells / cells).toFixed(0) },
    lockout, mandates, mandateDrops, outcomes,
    rotation: { legAccentDist, accentByMuscle, coreDist, coreExCount, sessionsWithCore },
    variety: { uniqueExercises: uniqueIds.size, instances: instances.length, top5, capViolations },
    goal,
  };
}

// ─── Real-state (S7) helpers ───
function loadWp3() {
  if (!fs.existsSync(WP3_PATH)) return null;
  return JSON.parse(fs.readFileSync(WP3_PATH, 'utf8').replace(/^﻿/, ''));
}
function describeRealLogs(wp3, app) {
  const logs = (wp3.logs || []).filter((l) => !l.isCardio);
  const byMuscle = {};
  const dates = new Set();
  logs.forEach((l) => {
    dates.add(logDayHost(l.date));
    (l.exercises || []).forEach((e) => {
      const sets = (e.sets || []).filter((s) => s && s.reps > 0).length;
      byMuscle[e.muscle] = (byMuscle[e.muscle] || 0) + sets;
    });
  });
  return {
    liftingLogs: logs.length, cardioLogs: (wp3.logs || []).length - logs.length,
    firstDate: logs.length ? logDayHost(logs[0].date) : null,
    lastDate: logs.length ? logDayHost(logs[logs.length - 1].date) : null,
    distinctDays: dates.size, setsByMuscle: byMuscle,
  };
}

// ─── Scenario matrix ───
function scenarios() {
  const list = [
    { name: 'S1 Baseline (lunch M-F)', availability: avLunchOnly, fatigue: 2 },
    { name: 'S2 Full schedule (+Tue/Thu/Sat eve)', availability: avFullSchedule, fatigue: 2 },
    { name: 'S3 Efficiency 3-day (eve M/W/F)', availability: avEfficiency3Day, fatigue: 2 },
    { name: 'S4 Fatigue stress (rating 5)', availability: avLunchOnly, fatigue: 5 },
    { name: 'S5 Sleep shield (rating 5 + 8h sleep)', availability: avLunchOnly, fatigue: 5, sleepHours: 8 },
    { name: 'S6 Missed sessions (~20% skipped)', availability: avFullSchedule, fatigue: 2, skipRate: 0.2, skipSeed: 42 },
    { name: 'S2t Retention cap (LOG_KEEP=60)', availability: avFullSchedule, fatigue: 2, logCap: 60 },
  ];
  const wp3 = loadWp3();
  if (wp3) {
    const lastLog = (wp3.logs || []).length ? logDayHost(wp3.logs[wp3.logs.length - 1].date) : START_MONDAY;
    let mon = addDaysHost(lastLog, 1);
    while (dowOf(mon) !== 1) mon = addDaysHost(mon, 1);
    list.push({
      name: 'S7 Real state (seeded from wp3 export)',
      startMonday: mon,
      availability: () => wp3.weekPlan && wp3.weekPlan.availability ? wp3.weekPlan.availability : undefined,
      fatigue: 2,
      seed: (app) => {
        Object.assign(app.S.cfg, wp3.cfg || {});
        app.S.logs = (wp3.logs || []).slice();
        app.S.customExercises = wp3.customExercises || [];
        app.S.lastWeights = wp3.lastWeights || {};
        app.S.sleepLog = wp3.sleepLog || {};
        if (wp3.weekPlan) app.S.weekPlan = { ...wp3.weekPlan, weekOf: null };
        if (!app.S.weekPlan.availability) app.S.weekPlan.availability = app.defaultAvailability();
      },
    });
  }
  return { list, wp3 };
}

// ─── Main ───
function main() {
  if (process.argv.includes('--smoke')) {
    const app = freshContext();
    setSim(START_MONDAY + 'T08:00:00');
    app.S.weekPlan = { weekOf: START_MONDAY, availability: app.defaultAvailability(), calGoal: null, recentWorkouts: '' };
    app.S.logs = []; app.S.sleepLog = {};
    const prog = app.genProgram(app.S.cfg, app.S.weekPlan.availability, []);
    if (!prog || !Array.isArray(prog.week) || prog.week.length !== 7) throw new Error('smoke: bad week');
    const days = prog.week.filter((d) => !d.rest);
    console.log(`smoke OK — genProgram loaded, LOG_KEEP=${app.LOG_KEEP}, ${days.length} training days:`);
    days.forEach((d) => console.log(`  dow ${d.dow} ${d.isLunch ? 'lunch' : 'eve'} "${d.name}" — ${d.exercises.map((e) => e.id).join(', ')}${d.eveningSession ? ` | eve: ${d.eveningSession.exercises.map((e) => e.id).join(', ')}` : ''}`));
    return;
  }

  const { list, wp3 } = scenarios();
  const results = [];
  for (const sc of list) {
    process.stdout.write(`running ${sc.name} ...`);
    const t0 = process.hrtime.bigint();
    results.push(runScenario(sc));
    console.log(` done (${Number((process.hrtime.bigint() - t0) / 1000000n)}ms)`);
  }
  const out = { generatedBy: 'analysis/case-study.js', anchor: START_MONDAY, weeks: WEEKS, results };
  if (wp3) { const app = freshContext(); out.realLogDescriptive = describeRealLogs(wp3, app); }
  else console.log(`note: ${path.relative(ROOT, WP3_PATH)} not found — S7 (real state) pending. Export with: copy(localStorage.getItem('wp3'))`);
  fs.writeFileSync(OUT_DATA, JSON.stringify(out, null, 2));
  console.log(`wrote ${path.relative(ROOT, OUT_DATA)}`);

  // Sanity gates (harness suspected first on failure).
  const s1 = results[0];
  const gates = [
    ['S1 lockout violations = 0', Object.values(s1.lockout).every((l) => l.violations === 0)],
    ['S1 lunch set rule 100%', s1.goal.lunchSetRule[0] === s1.goal.lunchSetRule[1]],
    ['S1 zero highSweat at lunch', s1.goal.lunchHighSweat === 0],
    ['S1 zero hip-risk picks', s1.goal.hipRiskPicks === 0],
    ['S1 zero avoid-list picks', s1.goal.avoidListPicks === 0],
  ];
  gates.forEach(([label, ok]) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`));
  if (gates.some(([, ok]) => !ok)) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { freshContext, runScenario, scenarios, setSim, addDaysHost, dowOf, mkLog, START_MONDAY, WEEKS, avLunchOnly, avFullSchedule, avEfficiency3Day };
