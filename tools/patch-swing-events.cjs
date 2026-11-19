// Studio swing triggers (prototype): world events for bots that hold an angle and swing when something happens.
// Patches the game bundles, safe to run again (marker /*studio-swing-events*/). Run patch-trades.cjs first.
//  1. CnrSARj_.js (simulation) keeps a short list of world events (ctx.studioEvents, each kept 6 ticks):
//       { tick, kind: "kill" | "hit", actorId, spawnerId, position }   you killed / damaged a bot
//       { tick, kind: "sound", source: "shot" | "footstep", position, radius }   a sound you made
//     - shot: pushed next to the "shot" event of the player's fire function (one per trigger pull).
//     - footstep: pushed from step(), right after the player's movement, every FOOT_STRIDE metres
//       walked, only while the player is on the ground (not on a rope), running: the crouch key is not
//       held and the crouch has fully ended (n.crouchAmount), and the walk key (Shift) is not held.
//       That is the engine's own movement choice, bM(crouch, walk) in BiMsX6Xn.js: crouch, else walk
//       (Shift), else run. Crouch-walking and shift-walking are silent; jumping/falling makes no step.
//     - the landing sound, and the swingChance roll: tools/patch-swing-jump-land-chance.cjs (run after this one).
//     - Not wired yet: reloads, weapon swaps, ability sounds, bot sounds.
//     - loudness radius (SHOT_RADIUS, FOOT_RADIUS) is carried on the event but the rule below does not
//       use it yet: a sound counts when its position is inside the rule's area.
//  2. BiMsX6Xn.js (dispatchers): a dispatcher with
//       swing: { radius, on: "kill" | "damage", at: {x,y,z}, delay: [lo, hi] }   (swingRadius in the Studio)
//       hear:  { area: {x0,z0,x1,z1}, sources: [...], delay: [lo, hi] }          (soundRule in the Studio)
//     holds its bot back until a matching event, then shows it after the delay (once per event, like a trade).
//     Radius: every holder within `radius` of the event is a candidate (a plain linear scan: each gate
//     measures its own distance); all candidates register for 2 ticks, then the NEAREST one swings.
//     Sound: every rule whose area holds the sound swings (no nearest pick).
//     Limits: a kill or hit by anything other than the player's weapon fire function is not seen.
// Usage: node tools/patch-swing-events.cjs   (patches app/site/next/js and app/site/_assets/r20261021-1/next/js)
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const MARK = "/*studio-swing-events*/";
const SHOT_RADIUS = 50, FOOT_RADIUS = 15, FOOT_STRIDE = 1.7; // metres; placeholders to tune by ear

const pos = (a) => `{x:${a}.position.x+${a}.offset.x,y:${a}.position.y+${a}.offset.y,z:${a}.position.z+${a}.offset.z}`;
const SIM = [
  // The event list and the footstep state live next to the movement flags (crouch / walk) they read.
  ["let cg=0,mg=0,Wg=!1,YB=!1;", `${MARK}let __aimEv=[],__aimFsP=null,__aimFsD=0;let cg=0,mg=0,Wg=!1,YB=!1;`],
  // New tick: drop events older than 6 ticks (and any "from the future" after a restoreState).
  ["step(c){if(U+=1,Wg=c.crouch,YB=c.walk,", "step(c){if(U+=1,__aimEv=__aimEv.filter(o=>o.tick<=U&&U-o.tick<=6),Wg=c.crouch,YB=c.walk,"],
  // Spawners and dispatchers get the list through ctx.
  ["aE=c=>({tick:c,elapsed:c*AA,profile:i,", "aE=c=>({tick:c,elapsed:c*AA,profile:i,studioEvents:__aimEv,"],
  // Footsteps: running on the ground (see the header), one every FOOT_STRIDE metres.
  ["yE(n,c,m());const QA=DA;", "yE(n,c,m());/*studio-sound-footstep*/{const fp=n.position,fl=__aimFsP;__aimFsP={x:fp.x,z:fp.z};" +
    "if(fl&&n.grounded&&!Dg(n)&&!c.crouch&&!c.walk&&!(n.crouchAmount>.02)){const fd=Math.hypot(fp.x-fl.x,fp.z-fl.z);" +
    `if(fd<1){__aimFsD+=fd;if(__aimFsD>=${FOOT_STRIDE}){__aimFsD=0;__aimEv.push({tick:U,kind:"sound",source:"footstep",position:{x:fp.x,y:fp.y,z:fp.z},radius:${FOOT_RADIUS}})}}}}const QA=DA;`],
  // Gunshots: one sound per trigger pull, from the eye.
  ["...B?{firingDeg:b}:{}});for(const V of dA){", `...B?{firingDeg:b}:{}});__aimEv.push({tick:U,kind:"sound",source:"shot",position:{x:x.x,y:x.y,z:x.z},radius:${SHOT_RADIUS}});for(const V of dA){`],
  // Damage that did not kill.
  ["if(z.health=IA,IA>0){const BA=bA.get(z.templateId)?.hitSlow===!0;ZI(z,",
    `if(z.health=IA,IA>0){const BA=bA.get(z.templateId)?.hitSlow===!0;__aimEv.push({tick:U,kind:"hit",actorId:z.id,spawnerId:z.spawnerId,position:${pos("z")}});ZI(z,`],
  // A kill (the killedTick part is patch-trades.cjs).
  ["z.alive=!1,z.killedTick=U,fB(z),c.push({tick:U,kind:\"kill\"",
    `z.alive=!1,z.killedTick=U,__aimEv.push({tick:U,kind:"kill",actorId:z.id,spawnerId:z.spawnerId,position:${pos("z")}}),fB(z),c.push({tick:U,kind:"kill"`],
];

// The gate: returns the swing delay [lo, hi] when this dispatcher should swing now, else null.
const HELPER = "/*studio-swing-gate*/function __aimSwingPick(e,t,a,live){const ev=a.studioEvents;if(!ev||!live)return null;const sw=e.swing,hr=e.hear,tk=a.tick;" +
  "for(const o of ev){if(o.done&&o.done[e.id])continue;let rd=null,hd=null;" +
  "if(o.kind===\"sound\"){if(hr&&hr.sources.includes(o.source)){const p=o.position,A=hr.area;if(p.x>=A.x0&&p.x<=A.x1&&p.z>=A.z0&&p.z<=A.z1)hd=hr.delay}}" +
  "else if(sw&&(o.kind===\"kill\"||o.kind===\"hit\"&&sw.on===\"damage\")&&o.spawnerId!==e.id){" +
  "const d=Math.hypot(o.position.x-sw.at.x,o.position.y-sw.at.y,o.position.z-sw.at.z);if(d<=sw.radius)rd=d}" +
  "if(hd){o.done=o.done||{};o.done[e.id]=1;return hd}if(rd===null)continue;" +
  // Radius: candidates register for 2 ticks (every gate runs at least once in that time), then the nearest wins.
  "if(o.regTick===void 0)o.regTick=tk,o.reg={};" +
  "if(o.reg[e.id]===void 0){if(tk-o.regTick>=2){o.done=o.done||{};o.done[e.id]=1;continue}o.reg[e.id]=rd;if(o.best===void 0||rd<o.best.d)o.best={d:rd,id:e.id}}" +
  "if(tk-o.regTick<2)continue;o.done=o.done||{};o.done[e.id]=1;if(o.best.id===e.id)return sw.delay}return null}";
const SP_FUNC = "function X8(n){const{node:e,runtime:t,usable:i,templates:r,actors:s,ctx:a,pickRng:o,timeRng:c}=n,l={born:[],shown:[]};";
const GATE_AT = "t.killWait=null;t.nextAt=a.elapsed}/* aim-dispatch-first";
const GATE = "/*studio-swing-gate*/if(e.swing||e.hear){if(u>0)return l;if(t.swWait===void 0)t.swWait=null;" +
  "if(t.swWait===null){const sd=__aimSwingPick(e,t,a,t.emitted<Eh(e));if(!sd)return t.nextAt=as,l;t.swWait=a.elapsed+c.range(sd[0],sd[1])}" +
  "if(a.elapsed<t.swWait)return l;t.swWait=null;t.nextAt=a.elapsed}";
const SPAWN = [
  [SP_FUNC, HELPER + SP_FUNC],
  [GATE_AT, "t.killWait=null;t.nextAt=a.elapsed}" + GATE + "/* aim-dispatch-first"],
];

// Applies every [from, to] to the text; each `from` must be found exactly once.
function edit(text, list, where) {
  for (const [from, to] of list) {
    if (text.split(from).length !== 2) throw new Error(`${where}: anchor not found exactly once: ${from.slice(0, 60)}`);
    text = text.replace(from, () => to);
  }
  return text;
}
for (const dir of DIRS) {
  const jobs = [["CnrSARj_.js", SIM, (s) => s.includes("z.killedTick=U")], ["BiMsX6Xn.js", SPAWN, () => true]];
  const out = [];
  for (const [name, list, ready] of jobs) {
    const file = path.join(ROOT, dir, name);
    const s = fs.readFileSync(file, "utf8");
    if (s.includes(MARK) || s.includes("/*studio-swing-gate*/")) { console.log(`${dir}/${name}: already patched`); continue; }
    if (!ready(s)) throw new Error(`${dir}/${name}: run tools/patch-trades.cjs first`);
    out.push([file, edit(s, list, `${dir}/${name}`)]);
  }
  for (const [file, text] of out) { fs.writeFileSync(file, text); console.log(`${path.relative(ROOT, file).replace(/\\/g, "/")}: patched`); }
}
