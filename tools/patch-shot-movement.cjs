// Player movement at each shot (17 Nov 2026, marker aim-shot-move): every player "shot" event now carries
//   move: { speed, forward, strafe, walk, crouch, air, sinceInput }
//     speed       horizontal speed in m/s at the shot tick: hypot(n.velocity.x, n.velocity.y), the simulation's own player velocity
//                 (x and z; "y" of that 2-vector is z). It is read after this tick's movement and wall collisions, so a player
//                 pressing into a wall reads 0. Not rounded here.
//     forward     -1, 0 or 1: the net forward / back input of the tick (both keys held cancel to 0)
//     strafe      -1, 0 or 1: the net left (-1) / right (+1) input of the tick
//     walk, crouch  0 / 1: the walk flag and crouch key the sim was given this tick
//     air         1 when the player is not grounded
//     sinceInput  ticks since the last tick with a forward / back / left / right input (0 when one is held now; counted from tick 0
//                 when there never was one)
// Only the shot event gets the new key (nothing the results code reads: shots, hits, kills and every other event are unchanged;
// no random number is drawn). The recorder (app/analytics-recorder.js) turns it into optional trailing fields of its shot row.
//  1. CnrSARj_.js (the simulation, in app/site/next/js and app/site/_assets/r20261021-1/next/js), three edits:
//       - next to the walk / crouch flags (let cg=0,mg=0,Wg=!1,YB=!1): the input tracker __aimMvI {f, s, t} and __aimShotMove()
//       - step(c): after Wg=c.crouch,YB=c.walk, the tracker takes the tick's forward / strafe input and the last tick one was held.
//         It must be done here because the shot code has its own `c` (the event list) and never sees the step's input.
//       - the player's shot event: ...__aimShotMove() spread in after firingDeg
//  2. app/site/local/worker-game-entry.mjs: the worker copies only chosen fields of a shot event for the recorder; it now copies .move too.
//     Needs tools/patch-analytics-hooks.cjs to have run first (it adds that copy). The worker's URL version in
//     app/site/local/threaded-game-bridge.mjs goes from analytics-2 to analytics-3 so a cached older worker script is not reused
//     (tools/patch-analytics-hooks.cjs accepts either version).
// Safe to run again ("already patched"); everything is checked before anything is written.
// Usage: node tools/patch-shot-movement.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const M = (n) => `/*aim-shot-move-${n}*/`;

const DECL = "let cg=0,mg=0,Wg=!1,YB=!1;";
const SHOT_MOVE = M(1) + "let __aimMvI={f:0,s:0,t:0};const __aimShotMove=()=>{try{const v=n.velocity,k=__aimMvI;" +
  "return{move:{speed:Math.hypot(v.x,v.y),forward:k.f,strafe:k.s,walk:YB?1:0,crouch:Wg?1:0,air:n.grounded?0:1,sinceInput:Math.max(0,U-k.t)}}}catch{return{}}};";
const STEP_FROM = "Wg=c.crouch,YB=c.walk,";
const STEP_TO = STEP_FROM + M(2) + "(__aimMvI.t>U&&(__aimMvI.t=0),__aimMvI.f=c.forward>0?1:c.forward<0?-1:0,__aimMvI.s=c.strafe>0?1:c.strafe<0?-1:0," +
  "(__aimMvI.f!==0||__aimMvI.s!==0)&&(__aimMvI.t=U)),";
const SHOT_FROM = "...B?{firingDeg:b}:{}});";

const SIM = [
  { from: DECL, to: DECL + SHOT_MOVE, marker: M(1) },
  { from: STEP_FROM, to: STEP_TO, marker: M(2) },
  { from: SHOT_FROM, to: "...B?{firingDeg:b}:{}," + M(3) + "...__aimShotMove()});", marker: M(3) },
];

const WORKER_FROM = "const slim={kind:'shot',tick:e.tick,origin:e.origin,direction:e.direction,hitActorId:e.hitActorId,hitPart:e.hitPart,hitPoint:e.hitPoint};";
const WORKER = [{ from: WORKER_FROM, to: WORKER_FROM + "/*aim-shot-move-4*/if(e.move)slim.move=e.move;", marker: "/*aim-shot-move-4*/" }];
const BRIDGE_OLD = "'/local/worker-game-entry.mjs?v=timeline-1-analytics-2'", BRIDGE_NEW = "'/local/worker-game-entry.mjs?v=timeline-1-analytics-3'";
const BRIDGE = [{ from: BRIDGE_OLD, to: BRIDGE_NEW, marker: BRIDGE_NEW }];

const plan = [];
function plan1(file, edits) {
  let s = fs.readFileSync(file, "utf8");
  const label = path.relative(SITE, file).replace(/\\/g, "/");
  const done = edits.filter((e) => s.includes(e.marker)).length;
  if (done === edits.length) { plan.push({ label, file, text: null }); return; }
  if (done !== 0) throw new Error(`${label}: partly patched (${done}/${edits.length} markers)`);
  for (const e of edits) {
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
