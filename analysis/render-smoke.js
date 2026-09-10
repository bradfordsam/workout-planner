#!/usr/bin/env node
'use strict';
// RENDER SMOKE TEST — the gate the syntax check cannot be:
// a ReferenceError inside a template literal is invisible to `new Function()`,
// and only executing the render functions catches it.
//
// Usage:  node analysis/render-smoke.js
//         SMOKE_FILE=/tmp/baseline.html node analysis/render-smoke.js   (A/B a baseline)
//
// Loads the script block up to the // INIT sentinel into a vm sandbox with a
// mocked DOM, localStorage and clock, fabricates a realistic S (a generated
// week plus three sessions of history), then calls every render path and
// asserts the output contains no undefined / NaN / [object Object].
// renderReviewWorkout is deliberately not called — it writes to innerHTML and
// always throws in the sandbox, which is expected, not a regression.
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
// SMOKE_FILE lets this run against a baseline copy written out with
// "git show HEAD:index.html", for an A/B the way the case-study harness is used.
const FILE=process.env.SMOKE_FILE||path.join(ROOT,'index.html');

const html=fs.readFileSync(FILE,'utf8');
const m=html.match(/<script>([\s\S]*?)<\/script>/);
const cut=m[1].indexOf('// INIT');
const SRC=m[1].slice(0,cut);

let simNowMs=Date.parse('2026-01-07T18:00:00');
class SimDate extends Date{constructor(...a){if(a.length===0)super(simNowMs);else super(...a);}static now(){return simNowMs;}}

const sandbox={
  console,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  document:(function(){const el=()=>({innerHTML:'',value:'',style:{},classList:{add(){},remove(){},toggle(){}},focus(){},scrollIntoView(){},addEventListener(){},removeEventListener(){},setAttribute(){},getAttribute:()=>null,appendChild(){},remove(){},dataset:{},checked:false,textContent:''});
    return{addEventListener(){},removeEventListener(){},getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:el,visibilityState:'hidden',body:el()};})(),
  navigator:{},alert(){},confirm:()=>false,prompt:()=>null,
  setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},
  fetch:()=>Promise.reject(new Error('no network')),
  location:{href:'https://sim.local/',search:'',hash:''},URLSearchParams,Date:SimDate,
};
sandbox.window=sandbox;sandbox.addEventListener=()=>{};sandbox.removeEventListener=()=>{};
const ctx=vm.createContext(sandbox);
vm.runInContext(SRC,ctx,{filename:'app.js'});
vm.runInContext('saveToCloud=async function(){};if(typeof pullFromCloudThrottled!=="undefined")pullFromCloudThrottled=function(){};',ctx);
const get=(e)=>vm.runInContext(e,ctx);
const S=get('S');

let pass=0,fail=0;
const ok=(cond,label)=>{if(cond){pass++;}else{fail++;console.log('  FAIL  '+label);}};
const clean=(s,label)=>{
  ok(typeof s==='string','string: '+label);
  if(typeof s!=='string')return;
  ['undefined','NaN','[object Object]'].forEach(bad=>{
    ok(!s.includes(bad),label+' contains no "'+bad+'"');
  });
};
const call=(expr,label)=>{try{return get(expr);}catch(e){fail++;console.log('  THROW '+label+': '+e.message);return null;}};

// ─── Set up realistic state ───
S.weekPlan={weekOf:'2026-01-05',availability:(()=>{
  const av=get('defaultAvailability()');
  av[2].eve={on:true,mins:60,loc:'ymca',equipment:'ymca'};
  av[4].eve={on:true,mins:60,loc:'ymca',equipment:'ymca'};
  av[6]={on:true,mins:75,loc:'apartment_gym',equipment:'apartment_gym'};
  return av;})(),calGoal:{cals:2000,startDate:'2026-01-05',endDate:'2026-01-11'}};
S.logs=[];
// Seed history: three sessions of squat + incline, the third down ~10% so the
// strength-trend monitor has something real to find.
const mkSets=(w,r,n)=>Array.from({length:n},()=>({weight:w,reps:r}));
[['2026-01-01',225,180],['2026-01-04',230,185],['2026-01-06',200,160]].forEach(([d,sq,inc],i)=>{
  S.logs.push({id:'L'+i,date:new Date(d+'T18:00:00').toISOString(),dayName:'Legs',isLunch:false,duration:60,
    exercises:[{id:'squat',name:'Barbell Back Squat',muscle:'legs',sets:mkSets(sq,5,3)},
               {id:'incline_db',name:'Incline DB Press',muscle:'chest',sets:mkSets(inc,6,3)}],fatigue:3});
});
get('recalcLastWeights()');
S.program=call('genProgram(S.cfg,S.weekPlan.availability,S.logs)','genProgram');
ok(!!S.program&&Array.isArray(S.program.week),'genProgram produced a week');

// ─── 1. Non-workout routes ───
S.view='dash';
[['renderDash()','renderDash'],['renderPlan()','renderPlan'],['renderProgram()','renderProgram'],
 ['renderHistory()','renderHistory'],['renderMRVWidget()','renderMRVWidget'],
 ['renderMRVBreakdown()','renderMRVBreakdown'],['centuryHTML()','centuryHTML'],
 ['lunchBudgetHTML(1)','lunchBudgetHTML'],['dailySpineHTML()','dailySpineHTML'],
 ['mcgillHTML(false)','mcgillHTML'],['pyramidHTML(todayDay())','pyramidHTML'],
 ['cindyHTML(todayDay())','cindyHTML'],['emomHTML(todayDay())','emomHTML'],
 ['centuryPrepHTML()','centuryPrepHTML'],['recoveryHTML(1)','recoveryHTML'],
].forEach(([expr,label])=>{const out=call(expr,label);if(out!==null)clean(out,label);});

// ─── 2. The new Plan-screen cards, in every block state ───
clean(call('blockPlanHTML()','blockPlanHTML draft'),'blockPlanHTML (draft, not started)');
clean(call('stapleLockPlanHTML()','stapleLockPlanHTML'),'stapleLockPlanHTML');
ok(call('blockActive()','blockActive')===false,'a seeded draft block is NOT active');
ok(call('blockRoles()','blockRoles')===null,'no roles while the block is unstarted');
ok(call('getMRVLimits().shoulders.min','mrv base')===8,'unstarted block leaves bands untouched');

// Start it.
S.cfg.block.start='2026-01-05';S.cfg.block.on=true;
ok(call('blockActive()','blockActive2')===true,'a started block IS active');
ok(call('blockWeek()','blockWeek')===1,'blockWeek is 1-based');
ok(call('blockWeeksTotal()','blockWeeksTotal')>=12,'a 4-month block is at least 12 weeks');
const lim=call('getMRVLimits()','limits');
ok(lim.shoulders.min===13&&lim.shoulders.max===18,'emphasis raises the FLOOR only (shoulders 8-18 -> 13-18)');
ok(lim.back.min===17&&lim.back.max===22,'emphasis raises the FLOOR only (back 12-22 -> 17-22)');
ok(lim.biceps.min===3&&lim.biceps.max===6,'maintenance ceiling = the old floor (biceps 6-16 -> 3-6)');
ok(lim.triceps.min===3&&lim.triceps.max===6,'maintenance ceiling = the old floor (triceps 6-16 -> 3-6)');
ok(lim.legs.min===14&&lim.legs.max===24,'an unroled muscle is untouched');
Object.keys(lim).forEach(k=>ok(lim[k].min<=lim[k].max,'band not inverted: '+k));
clean(call('blockPlanHTML()','blockPlanHTML active'),'blockPlanHTML (active)');
clean(call('renderPlan()','renderPlan active block'),'renderPlan with an active block');
// Expiry.
S.cfg.block.start='2020-01-01';
ok(call('blockActive()','blockActive3')===false,'a lapsed block stops steering');
ok(call('blockExpired()','blockExpired')===true,'a lapsed block reports expired');
ok(call('getMRVLimits().biceps.max','mrv after expiry')===16,'bands return to base once a block lapses');
clean(call('blockPlanHTML()','blockPlanHTML expired'),'blockPlanHTML (expired)');
S.cfg.block.start='2026-01-05';
// Efficiency mode must not invert a band.
const savedAv=S.weekPlan.availability;
S.weekPlan.availability=(()=>{const av={};[1,2,3,4,5].forEach(d=>{av[d]={lunch:false,eve:{on:[1,3,5].includes(d),mins:60,loc:'ymca',equipment:'ymca'}};});av[6]={on:false};av[0]={on:false};return av;})();
const elim=call('getMRVLimits()','efficiency limits');
Object.keys(elim).forEach(k=>ok(elim[k].min<=elim[k].max,'efficiency band not inverted: '+k));
ok(elim.biceps.max===3,'efficiency + maintenance collapses the ceiling to the old floor');
// The too-thin-for-two-emphasis warning, which is the whole reason chest does
// not silently finish a block on zero sets.
const thin3=call('weeklyLiftSlots(S.weekPlan.availability)','weeklyLiftSlots thin');
ok(thin3>0&&thin3<=4,'a 3-evening week has very few lift slots (got '+thin3+')');
ok(String(call('blockPlanHTML()','thin warn')).includes('leaves nothing for the others'),
   'a 2-muscle emphasis on a thin schedule shows the warning');
S.cfg.block.emphasis=['shoulders'];
ok(!String(call('blockPlanHTML()','thin warn off')).includes('leaves nothing for the others'),
   'a 1-muscle emphasis on the same schedule does not');
clean(call('blockPlanHTML()','blockPlanHTML thin'),'blockPlanHTML (thin schedule)');
S.cfg.block.emphasis=['shoulders','back'];
S.weekPlan.availability=savedAv;
ok(!String(call('blockPlanHTML()','thin warn full')).includes('leaves nothing for the others'),
   'the full schedule shows no thin warning');
ok(call('weeklyLiftSlots(S.weekPlan.availability)','weeklyLiftSlots full')>=5,
   'the full schedule has room for a 2-muscle emphasis');

// ─── 3. Staple lock ───
ok(call('stapleLockOn()','stapleLockOn')===true,'staple lock defaults on');
ok(!call('blockStapleIds()','blockStapleIds early').has('squat'),'a fresh block has no staples yet — it re-establishes them');
S.cfg.block.start='2025-12-01';
const staples=call('blockStapleIds()','blockStapleIds');
ok(staples&&staples.has('squat'),'a movement logged 3x inside the block is a staple');
ok(staples&&!staples.has('bb_row'),'an unlogged movement is not a staple');
S.cfg.block.on=false;
ok(call('blockStapleIds()','no block').has('squat'),'with no block running the window is the whole recent log');
S.cfg.block.on=true;S.cfg.block.start='2026-01-05';
S.cfg.stapleLock=false;
ok(call('blockStapleIds()','blockStapleIds off')===null,'staple lock off returns null');
S.cfg.stapleLock=true;

// ─── 4. Sequencing + tension ───
ok(call("[...SHORTENED_BIAS_IDS].every(id=>!LENGTHENED_PARTIAL_IDS.has(id))",'no contradiction')===true,
   'no id is classed both shortened and lengthened');
ok(call("lengthRank(exById('pushdown'))",'r1')===0,'pushdown ranks shortened');
ok(call("lengthRank(exById('incline_curl'))",'r2')===2,'incline curl ranks lengthened');
ok(call("lengthRank(exById('seated_cable_deadlift'))",'r3')===2,'a stretch-tagged movement ranks lengthened');
ok(call("lengthRank(exById('squat'))",'r4')===1,'a compound defaults to mid');
const seq=call(`(function(){
  const ids=['face_pulls','db_overhead_ext','pushdown','heavy_box_squat','db_row'];
  const exs=ids.map(id=>({...exById(id),sets:3}));
  flagFirstWorkingSet(exs);
  return exs.map(e=>e.id);
})()`,'sequencing');
ok(Array.isArray(seq)&&seq[0]==='heavy_box_squat','the heavy 1-5 lift leads the session');
ok(Array.isArray(seq)&&seq[seq.length-1]==='face_pulls','postural prehab closes the session');
ok(Array.isArray(seq)&&seq.indexOf('pushdown')<seq.indexOf('db_overhead_ext'),'within one muscle, shortened runs before lengthened');
ok(Array.isArray(seq)&&seq.length===5,'sequencing loses no exercises');
const seqAll=call(`(function(){
  const out=[];
  for(const d of (S.program.week||[])){
    if(!d||d.rest)continue;
    for(const s of [d,d.eveningSession]){
      if(!s||!s.exercises)continue;
      const c=s.exercises.map(e=>e.type);
      const lastC=c.lastIndexOf('compound'), firstNon=c.findIndex(t=>t!=='compound');
      out.push(firstNon===-1||lastC===-1||lastC<firstNon);
    }
  }
  return out;
})()`,'compound-first across the week');
ok(Array.isArray(seqAll)&&seqAll.every(Boolean),'every generated session runs compounds before accessories');
// The length/prehab ordering is a GUARANTEE, not a change: measured over 112
// generated sessions it never reorders one, because the generator's own slot
// order already happens to satisfy it. That is only worth anything if it is
// asserted — otherwise 'it never fires' and 'it is broken' look identical.
const inv=call(`(function(){
  const bad=[];
  for(const d of (S.program.week||[])){
    if(!d||d.rest)continue;
    for(const s of [d,d.eveningSession]){
      if(!s||!s.exercises)continue;
      const tail=s.exercises.filter(e=>e.type!=='compound');
      const pi=tail.findIndex(e=>PREHAB_FINISH_IDS.has(e.id));
      if(pi>=0&&pi!==tail.length-1)bad.push(s.name+': prehab not last');
      const byM={};
      tail.forEach(e=>{(byM[e.muscle]=byM[e.muscle]||[]).push(e);});
      Object.keys(byM).forEach(mm=>{
        const g=byM[mm].filter(e=>!PREHAB_FINISH_IDS.has(e.id)).map(lengthRank);
        for(let i=1;i<g.length;i++)if(g[i]<g[i-1])bad.push(s.name+': '+mm+' length order');
      });
    }
  }
  return bad;
})()`,'sequencing invariant');
ok(Array.isArray(inv)&&inv.length===0,'generated sessions satisfy the length/prehab ordering'+(inv&&inv.length?': '+inv.join(' | '):''));
['squat','pushdown','snap_down','wall_sit','heavy_box_squat'].forEach(id=>{
  const t=call("tensionNote(exById('"+id+"'))",'tensionNote '+id);
  ok(typeof t==='string','tensionNote returns a string for '+id);
  ok(!String(t).includes('undefined'),'tensionNote clean for '+id);
});
ok(call("tensionNote(exById('snap_down'))",'t1').includes('SPEED'),'speed-tagged work gets the speed line, not a tempo');
ok(call("tensionNote(exById('heavy_box_squat'))",'t2').includes('BAR SPEED'),'the heavy 1-5 tier gets the reserve line');
ok(call("tensionNote(exById('wall_sit'))",'t3')==='','a timed hold gets no tempo line');
ok(call("tensionNote(exById('pushdown'))",'t4').includes('TECHNICAL failure'),'hypertrophy work gets the tension line');
clean(call("TENSION_ROW(exById('pushdown'))",'TENSION_ROW'),'TENSION_ROW');
ok(call("TENSION_ROW(exById('wall_sit'))",'TENSION_ROW empty')==='','TENSION_ROW empty when there is no note');

// ─── 5. New movements resolve everywhere ───
['incline_machine_press','reverse_curl','forearm_curl','seated_cable_deadlift'].forEach(id=>{
  const def=call("exById('"+id+"')",'exById '+id);
  ok(!!def,'exById resolves '+id);
  if(!def)return;
  clean(call("cueBlockHTML(exById('"+id+"'),'#fff')",'cue '+id),'cueBlockHTML '+id);
  const est=call("estimateStartingWeight('"+id+"',S.logs,MOVEMENT_CLASS)",'est '+id);
  ok(est&&typeof est.weight==='number'&&!isNaN(est.weight),'estimateStartingWeight works for '+id);
  ok(call("!!resolveEx("+JSON.stringify(def.name)+")",'resolveEx '+id),'resolveEx finds '+id+' by name');
});
ok(call("EX.findIndex(e=>e.id==='incline_machine_press')<EX.findIndex(e=>e.id==='flat_db_press')",'order'),
   'incline machine press is ordered before both flat variants');
ok(call("legAutoOK(exById('seated_cable_deadlift'))",'legAutoOK')===false,
   'seated cable deadlift stays out of auto-generation');
// Cue splitting must stay lossless over the whole database after the cue edits.
const lossless=call(`(function(){
  const bad=[];
  [...EX].forEach(e=>{
    if(!e.cue)return;
    const b=cueBullets(e.cue);
    const joined=b.join(' ').replace(/\\s+/g,' ').trim();
    const orig=e.cue.replace(/\\s+/g,' ').trim();
    if(joined!==orig)bad.push(e.id);
  });
  return bad;
})()`,'cue sweep');
ok(Array.isArray(lossless)&&lossless.length===0,'cue bullet split is lossless over every EX entry'+(lossless&&lossless.length?' ('+lossless.join(',')+')':''));

// ─── 6. Strength-trend monitor ───
simNowMs=Date.parse('2026-01-07T18:00:00');
const drops=call('strengthTrendDrops()','strengthTrendDrops');
ok(Array.isArray(drops),'strengthTrendDrops returns an array');
ok(drops.length===2,'two corroborating movements are reported (got '+(drops&&drops.length)+')');
ok(drops.every(d=>d.pct>0&&d.name&&!/undefined/.test(d.name)),'each drop names a real movement and a positive %');
const adv=call('getRecoveryAdvisories()','getRecoveryAdvisories');
ok(Array.isArray(adv)&&adv.some(a=>/Strength is down/.test(a)),'the drop reaches the advisory banner');
adv.forEach((a,i)=>clean(a,'advisory '+i));
// Corroboration rule: one movement alone must stay silent.
const savedLogs=S.logs.slice();
S.logs=S.logs.map(l=>({...l,exercises:l.exercises.filter(e=>e.id==='squat')}));
ok(call('strengthTrendDrops()','solo').length===0,'a single lift down is NOT reported');
S.logs=savedLogs;
// A long gap is detraining, not fatigue.
const gapLogs=S.logs.map((l,i)=>i===2?{...l,date:new Date('2026-01-07T18:00:00').toISOString()}:{...l,date:new Date('2025-10-0'+(i+1)+'T18:00:00').toISOString()});
const realLogs=S.logs;S.logs=gapLogs;
ok(call('strengthTrendDrops()','gap').length===0,'a drop after a long layoff is not reported as fatigue');
S.logs=realLogs;

// ─── 7. Density structure ───
ok(call("CUSTOM_STRUCTURES.some(s=>s.key==='density')",'density listed'),'density is a custom structure');
clean(call("CUSTOM_STRUCTURES.map(s=>s.label+' '+s.sub).join(' ')",'structure labels'),'custom structure labels');
S.active={density:true};
clean(call('densityBannerHTML()','densityBanner'),'densityBannerHTML');
ok(call('densityBannerHTML()','db').includes('10'),'the density banner names the set count');
S.active=null;
ok(call("(function(){S.customSession={name:'D',mins:60,dow:3,equipmentKey:'ymca',isLunch:false,structure:'density',exercises:[{name:'Incline DB Press',sets:3}]};startCustomWorkout();const r=S.active&&S.active.exercises[0].sets;const d=S.active&&S.active.density;S.active=null;S.view='dash';return r===DENSITY_SETS&&d===true;})()",'density start'),
   'starting a density session forces 10 sets and flags the banner');

// ─── 8. The workout screen ───
S.view='dash';
const day=(S.program.week||[]).find(d=>d&&!d.rest&&d.exercises&&d.exercises.length);
ok(!!day,'the generated week has a liftable day');
if(day){
  call("startWorkout(S.program.week.find(d=>d&&!d.rest&&d.exercises&&d.exercises.length),'lunch')",'startWorkout');
  const w=call('renderWorkout()','renderWorkout');
  clean(w,'renderWorkout');
  ok(typeof w==='string'&&w.includes("class='view'"),'the workout screen keeps class="view"');
  ok(typeof w==='string'&&!w.includes("class='view rag"),'the workout screen still opts out of the rag layer');
  ok(typeof w==='string'&&w.includes('Tension:'),'the tension line renders on the workout card');
  // Every exercise index, so a bad template literal deeper in the list is caught.
  const n=(get('S.active')||{}).exercises.length;
  for(let i=0;i<n;i++){
    get('S.active.exIdx='+i);
    clean(call('renderWorkout()','renderWorkout ex'+i),'renderWorkout at exercise '+i);
  }
  get('S.active.exIdx=0');
  // Paired mode, since sequencing now reorders before pairSession runs.
  S.cfg.pairedSets=true;
  call("(function(){const d=S.program.week.find(x=>x&&!x.rest&&x.exercises&&x.exercises.length);S.active=null;startWorkout(d,'lunch');})()",'paired start');
  clean(call('renderWorkout()','renderWorkout paired'),'renderWorkout with paired sets on');
  S.cfg.pairedSets=false;
  S.active=null;
}
S.view='dash';
clean(call('renderDash()','renderDash final'),'renderDash after the block is active');

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
