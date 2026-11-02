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
 ['pyramidHTML(todayDay())','pyramidHTML'],
 ['cindyHTML(todayDay())','cindyHTML'],['emomHTML(todayDay())','emomHTML'],
 ['centuryPrepHTML()','centuryPrepHTML'],['recoveryHTML(1)','recoveryHTML'],
 ['strengthBalanceHTML()','strengthBalanceHTML'],['ptPrescribedHTML()','ptPrescribedHTML'],
 ['combatTestHTML(todayDay())','combatTestHTML'],
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
// The daily max's extra sets cost a lift per evening; this block tests the WARNING
// logic against the base ledger, so zero that charge here and restore it after.
get('DAILY_MAX_EXTRA_MINS.evening=0,DAILY_MAX_EXTRA_MINS.lunch=0');
const thin3=call('weeklyLiftSlots(S.weekPlan.availability)','weeklyLiftSlots thin');
ok(thin3>0&&thin3<=4,'a 3-evening week has very few lift slots (got '+thin3+')');
ok(String(call('blockPlanHTML()','thin warn')).includes('leaves nothing for the others'),
   'a 2-muscle emphasis on a thin schedule shows the warning');
S.cfg.block.emphasis=['shoulders'];
ok(!String(call('blockPlanHTML()','thin warn off')).includes('leaves nothing for the others'),
   'a 1-muscle emphasis on the same schedule does not');
get('DAILY_MAX_EXTRA_MINS.evening=12,DAILY_MAX_EXTRA_MINS.lunch=2');
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
ok(call("tensionNote(exById('pushdown'))",'t4').includes('technical failure'),'hypertrophy work gets the tension line');
ok(call("tensionNote(exById('pullups'))",'t5')==='','bodyweight work gets no tempo line');
ok(call("tensionNote(exById('crunches'))",'t6')==='','core work gets no tempo line');
// stretchRot is seeded off Date.now(), so walk 60 days to cover every rotation offset.
const bosuIn=(k)=>call(`(function(){const real=Date.now;try{return Array.from({length:60},(_,d)=>{Date.now=()=>real()+d*864e5;return prepPlan({isLegDay:true,equip:EQUIPMENT_PRESETS['${k}'].equipment});}).some(p=>JSON.stringify(p).includes('Balance Lunges'));}finally{Date.now=real;}})()`,'bosu '+k);
ok(bosuIn('ymca'),'Balance Lunges can appear at the YMCA (has a Bosu)');
ok(!bosuIn('apartment_gym'),'Balance Lunges never appear without a Bosu');
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
  const wantT=call("tensionNote(S.active.exercises[S.active.exIdx||0])!==''",'wantT');
  ok(typeof w==='string'&&w.includes('Tension:')===wantT,'the tension line renders exactly when the current lift has one');
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
  // A1/A2: the partner is part of THIS station, so Next Up, Next and Skip all
  // step past it. Fabricate a 3-lift session with lifts 0+1 paired.
  call("(function(){const d=S.program.week.find(x=>x&&!x.rest&&x.exercises&&x.exercises.length);S.active=null;startWorkout(d,'eve');const e=S.active.exercises;while(e.length<3)e.push({...e[0],id:'x'+e.length,name:'Filler '+e.length,done:[],pairId:null,pairPos:null});e.forEach(x=>{delete x.pairId;delete x.pairPos;});e[0].pairId='A';e[0].pairPos=1;e[1].pairId='A';e[1].pairPos=2;S.active.exIdx=0;})()",'pair fab');
  ok(call('nextStationIdx(0)','ns0')===2,'next station after an A1/A2 pair skips the partner');
  ok(call('nextStationIdx(2)','ns2')===3,'next station after a straight lift is the next index');
  const pw=call('renderWorkout()','renderWorkout pair');
  clean(pw,'renderWorkout on a pair');
  const names=get('S.active.exercises.map(e=>e.name)');
  const nu=pw.slice(pw.indexOf('Next Up'));
  ok(pw.includes('Next Up')&&nu.includes(names[2])&&!nu.slice(0,600).includes('>'+names[1]+'<'),'Next Up on A1 names the next station, not A2');
  S.active=null;
}
// ─── Daily max (2026-10-14) ───
ok(call("dailyMaxCycleWeek('2026-10-12')",'cw0')===0&&call("dailyMaxCycleWeek('2026-11-09')",'cw4')===4&&call("dailyMaxCycleWeek('2026-11-16')",'cw5')===0,'daily max cycles 4 on / 1 off from the anchor Monday');
ok(call("dailyMaxMode('2026-11-10')",'deload')==='off','week 5 of the cycle is a deload');
(function(){
  const mk="[{id:'bb_row',name:'Row',muscle:'back',type:'compound',eq:['barbell'],sets:3,tags:['horizontal']},{id:'flat_db_press',name:'Flat DB',muscle:'chest',type:'compound',eq:['dumbbells'],sets:3,tags:[]},{id:'crunches',name:'Crunch',muscle:'core',type:'isolation',eq:['bodyweight'],sets:3,tags:['flexion']}]";
  const eq="EQUIPMENT_PRESETS.ymca.equipment";
  const r=call(`(function(){const e=${mk};applyDailyMax(e,{dateStr:'2026-10-14',isLunch:false,equip:${eq},lockedMuscles:new Set()});flagFirstWorkingSet(e);return e.map(x=>x.id+':'+(x.dailyMax||'')+':'+x.sets).join(',');})()`,'press');
  ok(/^floor_press:press:6,/.test(r)&&r.includes('bb_row'),'non-leg evening: floor press max replaces the chest compound, leads, max + 5 (got '+r+')');
  const rl=call(`(function(){const e=${mk};applyDailyMax(e,{dateStr:'2026-10-14',isLunch:true,equip:${eq},lockedMuscles:new Set()});return e.find(x=>x.dailyMax).sets;})()`,'lunch');
  ok(rl===4,'lunch daily max is max + 3');
  const rc=call(`(function(){const e=${mk};applyDailyMax(e,{dateStr:'2026-10-14',isLunch:false,equip:${eq},lockedMuscles:new Set(['chest'])});return e.some(x=>x.dailyMax);})()`,'chest locked');
  ok(rc===false,'no press max while chest is inside its 48h window');
  const rb=call(`(function(){const e=[${mk}[0],${mk}[2]];applyDailyMax(e,{dateStr:'2026-10-14',isLunch:false,equip:${eq},lockedMuscles:new Set()});return e.map(x=>x.id).join(',');})()`,'back kept');
  ok(rb==='bb_row,crunches','the press never takes a back slot');
  const rleg=call(`(function(){const e=[{...exById('heavy_box_squat'),sets:3},${mk}[1]];applyDailyMax(e,{dateStr:'2026-10-14',isLunch:false,equip:${eq},lockedMuscles:new Set()});return e.map(x=>x.id+':'+(x.dailyMax||'')).join(',');})()`,'legs');
  ok(rleg.startsWith('heavy_trap_bar:legs')&&!rleg.includes(':press'),'recovered legs: the heavy strength slot becomes the trap bar max (got '+rleg+')');
  const rnob=call(`(function(){const e=[{...exById('heavy_box_squat'),sets:3}];applyDailyMax(e,{dateStr:'2026-10-14',isLunch:false,equip:EQUIPMENT_PRESETS.bodyweight.equipment,lockedMuscles:new Set()});return e[0].id;})()`,'no barbell');
  ok(rnob==='heavy_box_squat','with no allowed max lift the slot keeps its own movement');
  get("S.dmShoulderLog={'2026-10-14':true}");
  ok(call("dailyMaxMode('2026-10-18')",'hurt')==='legs'&&call("dailyMaxMode('2026-10-21')",'hurt2')==='on','shoulder hurt pulls the press for 7 days, then it returns');
  const rh=call(`(function(){const e=${mk};applyDailyMax(e,{dateStr:'2026-10-16',isLunch:false,equip:${eq},lockedMuscles:new Set()});return e.some(x=>x.dailyMax);})()`,'hurt press');
  ok(rh===false,'no press max while the shoulder flag is active');
  get("S.dmShoulderLog={}");
  const h=call("dailyMaxHTML(makeDailyMax(exById('floor_press'),'press',false))",'dmhtml');
  clean(h,'dailyMaxHTML');
  ok(h.includes('Daily max')&&h.includes('dm-shoulder-hurt')&&h.includes('5 × 2–3'),'floor press card shows the protocol and the shoulder-hurt button');
  ok(!call("dailyMaxHTML(makeDailyMax(exById('heavy_trap_bar'),'legs',false))",'dmleg').includes('dm-shoulder-hurt'),'trap bar card has no shoulder button');
  ok((function(){const off=call("dailyMaxMode(weekDateForDow(3))",'m3')==='off';return call("dailyMaxExtraMins(3,false)",'xm')===(off?0:12)&&call("dailyMaxExtraMins(3,true)",'xl')===(off?0:2);})(),'ledgers charge the extra heavy sets');
})();
// Left IT band block: fixed, every session, and the lunch warm-up still fits.
['lunch','evening'].forEach(k=>{
  const p=call(`prepPlan({isLunch:${k==='lunch'},isLegDay:true,hipCaution:true,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment})`,'prep '+k);
  ok(JSON.stringify(p).includes('Standing IT Band Lean'),'IT band block is in the '+k+' warm-up');
  const secs=call(`(function(){const p=prepPlan({isLunch:${k==='lunch'},isLegDay:true,hipCaution:true,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment});return p.blocks?p.blocks.reduce((a,b)=>a+b.items.reduce((x,it)=>x+prepItemSecs(it),0),0):-1})()`,'secs '+k);
  console.log('    '+k+' prep secs',secs,'cap',call(`PREP_BUDGET_MINS.${k}*60`,'cap'));
});
// Bounce isos: leg days only, and every hold actually gets dealt across two weeks
// at the realistic (hip+shoulder caution) budget — a block the cap always starves
// would look fine in a syntax check.
['lunch','evening'].forEach(k=>{
  const r=call(`(function(){const real=Date.now;try{const seen=new Set();let days=0;for(let d=0;d<14;d++){Date.now=()=>real()+d*864e5;const p=prepPlan({isLunch:${k==='lunch'},isLegDay:true,hipCaution:true,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment});const b=p.blocks.find(b=>b.key==='bounceiso');if(b){days++;b.items.forEach(it=>seen.add(it.n));}}return{days,seen:seen.size,total:BOUNCE_ISO_POOL.length,missing:BOUNCE_ISO_POOL.map(i=>i.n).filter(n=>!seen.has(n)).join(', ')};}finally{Date.now=real;}})()`,'bounce '+k);
  console.log('    '+k+' bounce isos: on',r.days,'of 14 leg days,',r.seen,'of',r.total,'holds dealt',r.missing?'(never: '+r.missing+')':'');
  ok(r.days>0,'bounce isos land in the '+k+' leg-day warm-up');
});
ok(!JSON.stringify(call(`prepPlan({isLunch:false,isLegDay:false,equip:EQUIPMENT_PRESETS.ymca.equipment})`,'bounce desk')).includes('bounceiso'),'bounce isos stay off non-leg days');
// Mobility picks: every session, all four dealt across two weeks on both day
// types and both budgets (needs a dumbbell gym — two of the four carry eq).
[['lunch',true],['lunch',false],['evening',true],['evening',false]].forEach(([k,leg])=>{
  const r=call(`(function(){const real=Date.now;try{const seen=new Set();let days=0;for(let d=0;d<14;d++){Date.now=()=>real()+d*864e5;const p=prepPlan({isLunch:${k==='lunch'},isLegDay:${leg},hipCaution:true,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment});const b=p.blocks.find(b=>b.key==='mobpicks');if(b){days++;b.items.forEach(it=>seen.add(it.n));}}return{days,missing:MOBILITY_PICKS_POOL.map(i=>i.n).filter(n=>!seen.has(n)).join(', ')};}finally{Date.now=real;}})()`,'mob '+k+leg);
  console.log('    '+k+(leg?' leg':' desk')+' mobility picks: on',r.days,'of 14 days',r.missing?'(never: '+r.missing+')':'(all 4 dealt)');
  // Lunch is the exception: the 6-min cap is spent on the leg blocks and (desk
  // days) the PT block, which ranks ahead at lunch, so full coverage is evenings.
  ok(r.days>0&&(!r.missing||k==='lunch'),'every mobility pick lands in the '+k+(leg?' leg':' desk')+' warm-up');
});
// Sprint hips: leg days only; all six cycle through the 15-min evening.
(function(){
  const r=call(`(function(){const real=Date.now;try{const seen=new Set();let days=0;for(let d=0;d<14;d++){Date.now=()=>real()+d*864e5;const p=prepPlan({isLunch:false,isLegDay:true,hipCaution:true,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment});const b=p.blocks.find(b=>b.key==='sprinthips');if(b){days++;b.items.forEach(it=>seen.add(it.n));}}return{days,missing:SPRINT_HIP_POOL.map(i=>i.n).filter(n=>!seen.has(n)).join(', ')};}finally{Date.now=real;}})()`,'sprint');
  console.log('    evening sprint hips: on',r.days,'of 14 leg days',r.missing?'(never: '+r.missing+')':'(all 6 dealt)');
  ok(r.days===14&&!r.missing,'every sprint-hip move lands in the evening leg warm-up');
  ok(!JSON.stringify(call(`prepPlan({isLunch:false,isLegDay:false,equip:EQUIPMENT_PRESETS.ymca.equipment})`,'sprint desk')).includes('sprinthips'),'sprint hips stay off non-leg days');
  ok(call('PREP_BUDGET_MINS.evening','cap')===15,'evening prep cap is 15');
})();
// Shoulder rehab is a daily home card, not a warm-up block (see SHOULDER_REHAB_POOL).
(function(){
  const was=call('S.cfg.shoulderCaution','sc');
  get('S.cfg.shoulderCaution=true');
  const on=call('dailySpineHTML()','rehab card on');clean(on,'shoulder rehab card');
  ok(on.includes('Left Shoulder Rehab')&&on.includes('Side-Lying External Rotation')&&on.includes('3/10'),'shoulder rehab card shows all six and the pain rule');
  get('S.cfg.shoulderCaution=false');
  ok(!call('dailySpineHTML()','rehab card off').includes('Left Shoulder Rehab'),'shoulder rehab card hidden when shoulder caution is off');
  get('S.cfg.shoulderCaution='+JSON.stringify(was));
  ok(!JSON.stringify(call(`prepPlan({isLunch:true,isLegDay:false,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment})`,'rehab prep')).includes('Side-Lying External Rotation'),'shoulder rehab stays out of the warm-up budget');
})();
// PT week complete → shoulder rehab takes the PT Hip slot; not before.
(function(){
  const base='isLegDay:false,hipCaution:true,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment';
  ['lunch','evening'].forEach(k=>{
    const L=k==='lunch';
    const off=JSON.stringify(call(`prepPlan({isLunch:${L},${base},ptWeekDone:false})`,'pt open '+k));
    ok(off.includes('pthip')&&!off.includes('shoulderrehab'),'PT not done: PT Hip block, no shoulder rehab ('+k+')');
    const on=call(`prepPlan({isLunch:${L},${base},ptWeekDone:true})`,'pt done '+k);
    const b=on.blocks.find(b=>b.key==='shoulderrehab');
    ok(b&&!on.blocks.some(b=>b.key==='pthip'),'PT done: shoulder rehab replaces the PT Hip block ('+k+')');
    ok(b&&b.items.every(it=>call(`prepItemSecs(${JSON.stringify(it)})`,'secs')>=50),'warm-up rehab items are priced from their reps ('+k+')');
    ok(on.secs<=call(`PREP_BUDGET_MINS.${k}*60`,'cap'),'swap stays inside the '+k+' cap');
    // all six cycle through in two weeks
    const miss=call(`(function(){const real=Date.now;try{const seen=new Set();for(let d=0;d<14;d++){Date.now=()=>real()+d*864e5;const p=prepPlan({isLunch:${L},${base},ptWeekDone:true});(p.blocks.find(b=>b.key==='shoulderrehab')||{items:[]}).items.forEach(it=>seen.add(it.n));}return SHOULDER_REHAB_POOL.map(i=>i.n).filter(n=>!seen.has(n)).join(', ');}finally{Date.now=real;}})()`,'rehab cycle '+k);
    console.log('    '+k+' desk, PT done: shoulder rehab '+(miss?'never: '+miss:'all 6 dealt in 14 days'));
  });
  ok(call(`prepPlan({isLunch:false,isLegDay:false,shoulderCaution:false,ptWeekDone:true,equip:EQUIPMENT_PRESETS.ymca.equipment})`,'sc off').blocks.some(b=>b.key==='pthip'),'shoulder caution off: PT Hip block stays');
  ok(typeof call('ptWeekComplete()','pwc')==='boolean','ptWeekComplete runs');
})();
// Who pays when a block is added: items dealt per block over 14 days. The prep
// budget is zero-sum, so read this line before and after any pool/block change.
[['lunch',true],['evening',true],['lunch',false],['evening',false]].forEach(([k,leg])=>{
  const r=call(`(function(){const real=Date.now;try{const c={};for(let d=0;d<14;d++){Date.now=()=>real()+d*864e5;prepPlan({isLunch:${k==='lunch'},isLegDay:${leg},hipCaution:true,shoulderCaution:true,equip:EQUIPMENT_PRESETS.ymca.equipment}).blocks.forEach(b=>{c[b.key]=(c[b.key]||0)+b.items.length;});}return Object.entries(c).map(([k,v])=>k+'='+v).join(' ');}finally{Date.now=real;}})()`,'dealt '+k+leg);
  console.log('    dealt/14d '+k+(leg?' leg ':' desk')+': '+r);
});
// PT in the time plan: today's owed PT is a line in sessionPlan, sheds after the
// spine holds, never changes the lift count, and drops off once logged.
(function(){
  const plan=(mins,dow)=>call(`sessionPlan({mins:${mins},dow:${dow},av:S.weekPlan&&S.weekPlan.availability,equipmentKey:'ymca',isLunch:false,lifts:2})`,'pt plan');
  const today=call('todayDow()','dow');
  call('S.ptLog={}','reset');
  const owedMins=call('ptMinsToday()','pt mins');
  const p=plan(120,today),pt=p.items.find(i=>i.key==='pt');
  console.log('    PT owed today:',owedMins,'min');
  ok(owedMins>0&&pt&&!pt.deferred&&pt.mins===owedMins,'owed PT is a kept line in a long session');
  ok(!plan(120,(today+1)%7).items.some(i=>i.key==='pt'),'PT is only priced on today');
  const tight=plan(45,today);
  const sp=tight.items.find(i=>i.key==='spine'),tp=tight.items.find(i=>i.key==='pt');
  ok(!tp||!tp.deferred||(sp&&sp.deferred),'PT sheds only after the spine holds');
  ok(call(`eveningLifts(60,${today},S.weekPlan&&S.weekPlan.availability,'ymca')`,'el')===call(`(function(){const s=ptMinsToday;ptMinsToday=()=>0;try{return eveningLifts(60,${today},S.weekPlan&&S.weekPlan.availability,'ymca')}finally{ptMinsToday=s}})()`,'el0'),'PT never changes the lift count');
  call(`PT_PRESCRIBED.forEach(ex=>{for(let i=0;i<7;i++)S.ptLog[ptLogKey(ex.id,todayStr())]=(S.ptLog[ptLogKey(ex.id,todayStr())]||0)+1})`,'log all');
  ok(!plan(120,today).items.some(i=>i.key==='pt'),'logged PT drops off the clock');
  call('S.ptLog={}','reset2');
})();
S.view='dash';
clean(call('renderDash()','renderDash final'),'renderDash after the block is active');

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
