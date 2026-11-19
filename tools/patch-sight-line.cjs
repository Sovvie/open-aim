// Sight line to each enemy (19 Nov 2026, marker aim-sightline): every enemy in the analytics snapshot now says whether the player can SEE it.
//   los: 1 = at least one of its points (head, chest, legs; for a sphere target its centre) has a clear line to the player's eye,
//        0 = walls, a smoke or a flash volume hide all of them. The key is only added while the analytics hook exists (the worker defines
//        globalThis.__aimAnalyticsFeed), and only for enemies that are alive, so normal play does no extra work and nothing else changes.
// Why: the recorder had no wall data. An enemy "came into view" when it was alive and inside the view cone, even when it stood behind a wall,
// so time to kill, flick or strafe, first-sight aim error and tracking all started too early. The recorder now starts on SIGHT.
// It reuses the game's own test for the enemy AI (canSee, tE in CnrSARj_.js): a ray from the point to the player's eye against the map
// (wD), the player's smokes (IC), copycat smokes and flash volumes (cC), so it agrees with what the bots themselves treat as visible.
//  1. CnrSARj_.js (the simulation, in app/site/next/js and app/site/_assets/r20261021-1/next/js):
//       - next to canSee: __aimLos(c) -> { los: 0 | 1 } or {} (the actor is dead, or analytics is off, or anything throws)
//       - snapshot(): the actor entries spread __aimLos(c) in after behavior
//  2. app/site/local/worker-game-entry.mjs: the worker copies los into the actors it posts to the recorder (a.los 0 or 1 only), and the
//     player's blindUntil (seconds of round time; a flash sets it): while it is ahead of the tick the player cannot see anything, so no enemy is "seen".
//     Enemies often see the player when the player cannot see them (off screen, behind, through smoke, while flashed): the recorder tells the two apart.
//     The worker's URL version in app/site/local/threaded-game-bridge.mjs goes from analytics-3 to analytics-4 so a cached older worker is not reused.
// Safe to run again ("already patched"); everything is checked before anything is written. Needs patch-analytics-hooks.cjs and patch-shot-movement.cjs first.
// Usage: node tools/patch-sight-line.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const M = (n) => `/*aim-sightline-${n}*/`;

// Points tested on an actor, as heights above its feet in metres at scale 1 (a humanoid), or the actor's own position (a sphere).
const LOS_FN = M(1) + "__aimLos=c=>{try{if(!globalThis.__aimAnalyticsFeed||c.alive===!1)return{};" +
  "const o=c.offset||{x:0,y:0,z:0},s=typeof c.scale===\"number\"&&c.scale>0?c.scale:1,T=bA.get(c.templateId),sp=T&&T.body&&T.body.shape===\"sphere\"," +
  "x=c.position.x+o.x,y=c.position.y+o.y,z=c.position.z+o.z;" +
  "for(const h of sp?[0]:[1.62,1.15,.5])if(tE({x,y:y+h*s,z}))return{los:1};return{los:0}}catch{return{}}}";
const ME_FROM = ",ME=c=>{const G=OA(n,a);if(c===\"head\")return G;";
const SNAP_FROM = "offset:uA(c.offset),behavior:cB(c.behavior)}})";

const SIM = [
  { from: ME_FROM, to: "," + LOS_FN + ME_FROM, marker: M(1) },
  { from: SNAP_FROM, to: "offset:uA(c.offset),behavior:cB(c.behavior)," + M(2) + "...(typeof __aimLos===\"function\"?__aimLos(c):{})}})", marker: M(2) },
];

const WORKER_FROM = "scale:a.scale??1,alive:a.alive===true,visible:a.visible===true});";
const BLIND_FROM = "crouchAmount:p.crouchAmount??0,weapon:p.weapon??null,knife:p.knife??0}";
const WORKER = [{ from: BLIND_FROM, to: "crouchAmount:p.crouchAmount??0,weapon:p.weapon??null,knife:p.knife??0," + M(5) + "...(typeof p.blindUntil===\"number\"?{blindUntil:p.blindUntil}:{})}", marker: M(5) }, { from: WORKER_FROM, to: "scale:a.scale??1,alive:a.alive===true,visible:a.visible===true," + M(3) + "...(a.los===0||a.los===1?{los:a.los}:{})});", marker: M(3) }];
const BRIDGE_OLD = "'/local/worker-game-entry.mjs?v=timeline-1-analytics-3'", BRIDGE_NEW = "'/local/worker-game-entry.mjs?v=timeline-1-analytics-4'";
const BRIDGE = [{ from: BRIDGE_OLD, to: BRIDGE_NEW, marker: BRIDGE_NEW }];

const plan = [];
function plan1(file, edits) {
  let s = fs.readFileSync(file, "utf8");
  const label = path.relative(SITE, file).replace(/\\/g, "/");
  const todo = edits.filter((e) => !s.includes(e.marker));
  if (!todo.length) { plan.push({ label, file, text: null }); return; }
  for (const e of todo) {
    const n = s.split(e.from).length - 1;
    if (n !== 1) throw new Error(`${label}: anchor for ${e.marker} found ${n} times, expected 1: ${e.from.slice(0, 60)}`);
    s = s.replace(e.from, () => e.to);
  }
  plan.push({ label, file, text: s });
}
for (const dir of DIRS) plan1(path.join(SITE, dir, "CnrSARj_.js"), SIM);
plan1(path.join(SITE, "local", "worker-game-entry.mjs"), WORKER);
plan1(path.join(SITE, "local", "threaded-game-bridge.mjs"), BRIDGE);
for (const p of plan) {
  if (p.text === null) console.log(`${p.label}: already patched`);
  else { fs.writeFileSync(p.file, p.text); console.log(`${p.label}: patched`); }
}
