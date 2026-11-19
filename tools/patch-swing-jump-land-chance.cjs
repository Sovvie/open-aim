// Studio swing triggers, part 2 (prototype). Run AFTER patch-trades.cjs and patch-swing-events.cjs; safe to run again.
//  1. CnrSARj_.js (simulation): a landing sound event, same shape as the footstep event:
//       { tick, kind: "sound", source: "land", position: {x,y,z}, radius: LAND_RADIUS }
//     - No jump event: Valorant-style reports say jumps up onto high ground are silent, so only landings count.
//     - land: the tick the player touches the ground again. Fall distance = highest feet y seen in the air minus the
//       landing y. Under LAND_MIN_FALL metres: no event (stairs, curbs, small steps). A normal jump on flat ground is
//       about 1.15 m (launchSpeed 7.5, gravity 24.46), so it does make a landing sound.
//       Unknown history (just spawned, restoreState, just left a rope) never lands.
//     Position is the feet (n.position), like the footstep. Markers: /*studio-sound-jumpland*/
//  2. BiMsX6Xn.js (dispatchers): swingChance (0-1) on a swing / hear gate (dispatcher-level swingChance is the fallback,
//     missing or not a number = 1). When a gate would fire (the event matched, and for a radius trigger it is the
//     nearest holder), it rolls the dispatcher's own timeRng (rng.next() < swingChance). A failed roll means no swing for
//     that event, the bot stays put. One roll per matched event per gate (the event is marked done before the roll).
//     Chance >= 1 or missing never touches the rng, so old drills replay exactly as before. Marker: /*studio-swing-chance*/
// Usage: node tools/patch-swing-jump-land-chance.cjs [siteRoot]   (default app/site; patches next/js and _assets/r20261021-1/next/js)
const fs = require("fs"), path = require("path");
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const MARK_SIM = "/*studio-sound-jumpland*/", MARK_GATE = "/*studio-swing-chance*/";
const LAND_RADIUS = 20;      // metres; louder than a footstep, quieter than a gunshot (50)
const LAND_MIN_FALL = 0.5;   // metres of fall (peak y minus landing y) below which no land sound is made

const SIM = [
  // State: last tick seen, grounded state (true / false / null unknown), highest y since take-off.
  ["let __aimEv=[],__aimFsP=null,__aimFsD=0;", `let __aimEv=[],__aimFsP=null,__aimFsD=0;${MARK_SIM}let __aimJt=-9,__aimJg=null,__aimJy=0;`],
  // Right after the player's movement, before the footstep block.
  ["/*studio-sound-footstep*/{const fp=n.position,fl=__aimFsP;",
    `${MARK_SIM}{const jp=n.position,jr=Dg(n),jg=n.grounded&&!jr;if(__aimJt!==U-1)__aimJg=null;__aimJt=U;` +
    "if(jr)__aimJg=null;" +
    `else if(jg){if(__aimJg===!1&&__aimJy-jp.y>=${LAND_MIN_FALL})__aimEv.push({tick:U,kind:"sound",source:"land",position:{x:jp.x,y:jp.y,z:jp.z},radius:${LAND_RADIUS}});__aimJg=!0;__aimJy=jp.y}` +
    `else{const jw=__aimJg;` +
    "__aimJy=jw===null?jp.y:Math.max(__aimJy,jp.y);__aimJg=!1}}" +
    "/*studio-sound-footstep*/{const fp=n.position,fl=__aimFsP;"],
];

const ROLL = `${MARK_GATE}function __aimRoll(g,e,rng){let p=g&&g.swingChance;if(typeof p!=="number"||!Number.isFinite(p))p=e.swingChance;` +
  "if(typeof p!==\"number\"||!Number.isFinite(p)||p>=1)return!0;if(p<=0)return!1;return rng.next()<p}";
const GATE = [
  ["function __aimSwingPick(e,t,a,live){", ROLL + "function __aimSwingPick(e,t,a,live,rng){"],
  // Sound rule: the event is already marked done for this gate, so a failed roll is final for it.
  ["if(hd){o.done=o.done||{};o.done[e.id]=1;return hd}if(rd===null)continue;",
    "if(hd){o.done=o.done||{};o.done[e.id]=1;if(__aimRoll(hr,e,rng))return hd;continue}if(rd===null)continue;"],
  // Radius rule: the nearest holder (the one that would swing) rolls.
  ["if(o.best.id===e.id)return sw.delay}return null}", "if(o.best.id===e.id&&__aimRoll(sw,e,rng))return sw.delay}return null}"],
  ["__aimSwingPick(e,t,a,t.emitted<Eh(e))", "__aimSwingPick(e,t,a,t.emitted<Eh(e),c)"],
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
  const jobs = [
    ["CnrSARj_.js", SIM, MARK_SIM, (s) => s.includes("/*studio-sound-footstep*/")],
    ["BiMsX6Xn.js", GATE, MARK_GATE, (s) => s.includes("/*studio-swing-gate*/function __aimSwingPick(")],
  ];
  const out = [];
  for (const [name, list, mark, ready] of jobs) {
    const file = path.join(ROOT, dir, name);
    const s = fs.readFileSync(file, "utf8");
    if (s.includes(mark)) { console.log(`${dir}/${name}: already patched`); continue; }
    if (!ready(s)) throw new Error(`${dir}/${name}: run tools/patch-trades.cjs and tools/patch-swing-events.cjs first`);
    out.push([file, edit(s, list, `${dir}/${name}`)]);
  }
  for (const [file, text] of out) { fs.writeFileSync(file, text); console.log(`${path.relative(ROOT, file).replace(/\\/g, "/")}: patched`); }
}
