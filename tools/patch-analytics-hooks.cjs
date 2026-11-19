// Analytics hooks (16 Nov 2026 marker aim-analytics-v1, extended 17 Nov 2026 to aim-analytics-v2): three one-line calls out of the
// game's round code, so app/analytics-recorder.js can record every shot, every death, and (v2) every engagement and near miss.
// Safe to run again, and it upgrades a v1-patched tree in place. Nothing is recorded by the patch itself; with no recorder
// installed each call is a no-op (optional call on an undefined global).
//
//  1. OkAdunfX.js (game loop, in app/site/next/js and app/site/_assets/r20261021-1/next/js):
//       To(): after gt=Fv(F,ve)     -> globalThis.__aimAnalyticsStart?.({id,map,weapon,mode,dt,kinds})
//            kinds = [[template id, body shape, body radius, headSize], ...] (v2 adds radius and headSize for the near-miss boxes)
//       tick: after __aimTimeline.tick(Ae,Ze) -> globalThis.__aimAnalyticsFeed?.(Ae,Ze)
//            v1 called it only for ticks that have events; v2 calls it on EVERY tick (Ze may be empty), because the recorder needs
//            the aim angles (Ae.player.yaw / pitch) and the enemy positions of every tick to measure aim travel and engagements.
//       Du(): round complete        -> globalThis.__aimAnalyticsEnd?.(F)   (F = "cleared" | "died" | "time")
//     The simulation events the game keeps (shot, kill, enemyShot, playerDead) are not otherwise reachable from the
//     page: window.__aimShot gets shot events only, and they carry no weapon, no distance and no kill flag.
//  2. app/site/local/worker-game-entry.mjs: the game normally runs in a worker, where those globals do not exist.
//     It defines them there, keeps only the events, actors and player angles the recorder needs, and posts {type:"analytics"}.
//     v2 batches the per-tick samples (32 ticks per message) instead of posting every tick.
//  3. app/site/local/threaded-game-bridge.mjs: hands that message to window.__aimAnalytics.receive() on the page,
//     and bumps the worker's URL version so a cached copy of worker-game-entry.mjs is not reused.
// Player movement and input at each shot is added on top by tools/patch-shot-movement.cjs (run after this one).
// Usage: node tools/patch-analytics-hooks.cjs      (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const MARK = "aim-analytics-v1"; // the first version's marker (still on the end hook and the bridge)
const MARK2 = "aim-analytics-v2";

// edits: [{ from, to, marker, old? }] (marker may be a list: any of them present means done, so a later script's newer text is accepted).
// For each edit: if its marker is present it is done; else if `old` (the text an earlier
// version of this script wrote) is present exactly once it is replaced by `to`; else `from` (the original game text) must
// be found exactly once. Everything is checked before anything is written, so a changed bundle stops the script instead of
// being patched halfway. A file where every marker is present prints "already patched".
function patchFile(file, edits) {
  let text = fs.readFileSync(file, "utf8");
  const label = path.relative(SITE, file).replace(/\\/g, "/");
  const todo = edits.filter((e) => ![].concat(e.marker).some((m) => text.includes(m)));
  if (todo.length === 0) { console.log(`${label}: already patched`); return; }
  const plan = todo.map((e) => {
    const upgrade = e.old !== undefined && text.includes(e.old);
    const find = upgrade ? e.old : e.from;
    const count = text.split(find).length - 1;
    if (count !== 1) throw new Error(`${label}: anchor ${JSON.stringify(find.slice(0, 60))} found ${count} times, expected once`);
    return { find, to: e.to, upgrade };
  });
  for (const p of plan) text = text.replace(p.find, () => p.to); // function: no $ patterns
  fs.writeFileSync(file, text);
  console.log(`${label}: ${plan.every((p) => p.upgrade) ? "upgraded" : "patched"}`);
}

const START_V1 = "gt=Fv(F,ve),/*" + MARK + ":start*/globalThis.__aimAnalyticsStart?.({id:F.meta?.id??null,map:F.environment?.map??null," +
  "weapon:F.rules?.weapon??null,mode:F.rules?.scoring??null,dt:ve,kinds:(F.actors??[]).map(a=>[a.id,a.body?.shape??null])}),";
const TICK_V1 = "__aimTimeline.tick(Ae,Ze);/*" + MARK + ":tick*/Ze.length>0&&globalThis.__aimAnalyticsFeed?.(Ae,Ze);";
const ENGINE = [
  { // the round's scene is loaded (also on every restart): the recorder starts a new round
    from: "gt=Fv(F,ve),",
    old: START_V1,
    marker: `/*${MARK2}:start*/`,
    to: "gt=Fv(F,ve),/*" + MARK2 + ":start*/globalThis.__aimAnalyticsStart?.({id:F.meta?.id??null,map:F.environment?.map??null," +
      "weapon:F.rules?.weapon??null,mode:F.rules?.scoring??null,dt:ve,kinds:(F.actors??[]).map(a=>[a.id,a.body?.shape??null,a.body?.radius??null,a.body?.headSize??null])}),",
  },
  { // after every simulated tick of a running round, with its snapshot and events (events may be empty)
    from: "__aimTimeline.tick(Ae,Ze);",
    old: TICK_V1,
    marker: `/*${MARK2}:tick*/`,
    to: "__aimTimeline.tick(Ae,Ze);/*" + MARK2 + ":tick*/globalThis.__aimAnalyticsFeed?.(Ae,Ze);",
  },
  { // the round ended (cleared, died, time up)
    from: "function Du(F){if(!Ve)return;ya();",
    marker: `/*${MARK}:end*/`,
    to: "function Du(F){if(!Ve)return;ya();/*" + MARK + ":end*/globalThis.__aimAnalyticsEnd?.(F);",
  },
];
for (const dir of ["next/js", "_assets/r20261021-1/next/js"]) patchFile(path.join(SITE, dir, "OkAdunfX.js"), ENGINE);

const WORKER_FROM = "globalThis.__aimTimelineSink=(data,buffers)=>send({type:'timeline',data},buffers);";
const WORKER_V1 = WORKER_FROM + `
 /* ${MARK}: the worker keeps only what the recorder (page side, app/analytics-recorder.js) reads, and posts it. */
 {
  const KEEP={shot:1,kill:1,enemyShot:1,playerDead:1,playerFell:1};
  globalThis.__aimAnalyticsStart=info=>{try{send({type:'analytics',kind:'start',info:wire(info)})}catch{}};
  globalThis.__aimAnalyticsEnd=reason=>{try{send({type:'analytics',kind:'end',reason:typeof reason==='string'?reason:null})}catch{}};
  globalThis.__aimAnalyticsFeed=(snap,events)=>{try{
   const events2=[],ids=new Set();
   for(const e of events){
    if(!KEEP[e.kind])continue;
    if(e.kind==='shot'){
     const slim={kind:'shot',tick:e.tick,origin:e.origin,hitActorId:e.hitActorId,hitPart:e.hitPart,hitPoint:e.hitPoint};
     if(e.pellets)slim.pellets=e.pellets.map(p=>({hitActorId:p.hitActorId,hitPart:p.hitPart}));
     if(e.also)slim.also=e.also.map(a=>({actorId:a.actorId,part:a.part}));
     events2.push(slim);
     if(e.hitActorId!=null)ids.add(e.hitActorId);
     for(const p of e.pellets??[])if(p.hitActorId!=null)ids.add(p.hitActorId);
     for(const a of e.also??[])if(a.actorId!=null)ids.add(a.actorId);
    }else{events2.push(e);if(e.actorId!=null)ids.add(e.actorId);}
   }
   if(!events2.length)return;
   const p=snap.player,actors=[];
   for(const a of snap.actors)if(ids.has(a.id))actors.push({id:a.id,templateId:a.templateId});
   send({type:'analytics',kind:'tick',snap:{tick:snap.tick,player:{position:{x:p.position.x,y:p.position.y,z:p.position.z},weapon:p.weapon??null,knife:p.knife??0},actors},events:wire(events2)});
  }catch{}};
 }`;
const WORKER_TO = WORKER_FROM + `
 /* ${MARK2}: the worker keeps only what the recorder (page side, app/analytics-recorder.js) reads, and posts it.
    Every tick it adds one sample (aim angles, player position, live enemies, this tick's events) to a batch that is posted with
    32 ticks, at round start and at round end, so the page is not messaged 128 times a second. */
 {
  const KEEP={shot:1,kill:1,enemyShot:1,playerDead:1,playerFell:1};
  let batch=[];
  const flush=()=>{if(!batch.length)return;const list=batch;batch=[];try{send({type:'analytics',kind:'ticks',list:wire(list)})}catch{}};
  globalThis.__aimAnalyticsStart=info=>{try{flush();send({type:'analytics',kind:'start',info:wire(info)})}catch{}};
  globalThis.__aimAnalyticsEnd=reason=>{try{flush();send({type:'analytics',kind:'end',reason:typeof reason==='string'?reason:null})}catch{}};
  globalThis.__aimAnalyticsFeed=(snap,events)=>{try{
   const events2=[],ids=new Set();
   for(const e of events??[]){
    if(!KEEP[e.kind])continue;
    if(e.kind==='shot'){
     const slim={kind:'shot',tick:e.tick,origin:e.origin,direction:e.direction,hitActorId:e.hitActorId,hitPart:e.hitPart,hitPoint:e.hitPoint};
     if(e.pellets)slim.pellets=e.pellets.map(p=>({hitActorId:p.hitActorId,hitPart:p.hitPart}));
     if(e.also)slim.also=e.also.map(a=>({actorId:a.actorId,part:a.part}));
     events2.push(slim);
     if(e.hitActorId!=null)ids.add(e.hitActorId);
     for(const p of e.pellets??[])if(p.hitActorId!=null)ids.add(p.hitActorId);
     for(const a of e.also??[])if(a.actorId!=null)ids.add(a.actorId);
    }else{events2.push(e);if(e.actorId!=null)ids.add(e.actorId);}
   }
   const p=snap.player,actors=[];
   for(const a of snap.actors)if((a.alive===true&&a.visible===true)||ids.has(a.id)){const o=a.offset;actors.push({id:a.id,templateId:a.templateId,bornTick:a.bornTick,position:{x:a.position.x+(o?o.x:0),y:a.position.y+(o?o.y:0),z:a.position.z+(o?o.z:0)},scale:a.scale??1,alive:a.alive===true,visible:a.visible===true});}
   const entry={snap:{tick:snap.tick,player:{position:{x:p.position.x,y:p.position.y,z:p.position.z},yaw:p.yaw,pitch:p.pitch,crouchAmount:p.crouchAmount??0,weapon:p.weapon??null,knife:p.knife??0},actors}};
   if(events2.length)entry.events=events2;
   batch.push(entry);
   if(batch.length>=32)flush();
  }catch{}};
 }`;
patchFile(path.join(SITE, "local", "worker-game-entry.mjs"), [{ from: WORKER_FROM, old: WORKER_V1, to: WORKER_TO, marker: `/* ${MARK2}:` }]);

const BRIDGE_TIMELINE = "if(m.type==='timeline'){globalThis.__aimTimelineSink?.(m.data);return;}";
patchFile(path.join(SITE, "local", "threaded-game-bridge.mjs"), [
  {
    from: BRIDGE_TIMELINE,
    marker: `/* ${MARK} */`,
    to: BRIDGE_TIMELINE + "\n  /* " + MARK + " */ if(m.type==='analytics'){try{window.__aimAnalytics?.receive(m)}catch{}return;}",
  },
  {
    from: "'/local/worker-game-entry.mjs?v=timeline-1'",
    old: "'/local/worker-game-entry.mjs?v=timeline-1-analytics-1'",
    // tools/patch-shot-movement.cjs moves the version on to analytics-3: that is also done
    marker: ["'/local/worker-game-entry.mjs?v=timeline-1-analytics-2'", "'/local/worker-game-entry.mjs?v=timeline-1-analytics-3'", "'/local/worker-game-entry.mjs?v=timeline-1-analytics-4'"],
    to: "'/local/worker-game-entry.mjs?v=timeline-1-analytics-2'",
  },
]);
