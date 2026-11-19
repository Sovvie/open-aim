// Enemy tracer drawing (17 Nov 2026, marker aim-enemy-tracer-draw): OkAdunfX.js used to guess each enemy shot's path
// (1.45 m eye height, a pseudo-random 0.65 m miss jitter, wall-blocked shots skipped). It now draws the path the
// game resolved: origin, direction and hitPoint on the "enemyShot" event (tools/patch-enemy-shot-tracer.cjs), turned
// into a tracer shot by app/site/aim-tracers/enemy-shots.mjs and drawn by aim-tracers/renderer.mjs in the "enemy" style.
// Shots stopped by a wall are drawn up to the wall. Enemy fire sound and hit feedback are unchanged.
// Usage: node tools/patch-enemy-tracer-draw.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const M = n => `/*aim-enemy-tracer-draw-${n}*/`;

const OLD_DRAW = 'if(c.customActive&&Be&&he.wall!=="blocked"){const origin={x:Be.position.x+Be.offset.x,y:Be.position.y+Be.offset.y+1.45,z:Be.position.z+Be.offset.z},' +
  'target={x:Ae.player.position.x,y:Ae.player.position.y+(he.zone==="head"?1.5:he.zone==="legs"?.4:1)*(1-.3*(Ae.player.crouchAmount??0)),z:Ae.player.position.z};' +
  'if(!he.hit){const angle=(he.tick*1.618+he.actorId)*2.399;target.x+=Math.cos(angle)*.65;target.z+=Math.sin(angle)*.65;}' +
  'if(!de.sightBlocked(origin,target))c.shoot({source:"enemy",actorId:he.actorId,at:he.tick*ve,weapon:yo.get(Be.templateId)??"vandal",origin,' +
  'direction:{x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z},hitPoint:target,seed:he.tick*64+he.actorId});}';
const NEW_DRAW = M(2) + 'if(c.customActive&&Be){const __aimEs=__aimEnemyTracerShot(he,he.tick*ve,yo.get(Be.templateId)??"vandal");__aimEs&&c.shoot(__aimEs);}';

const IMPORT = "import {createTracers as __aimCreateTracers} from '/aim-tracers/renderer.mjs';";

const FILES = {
  "OkAdunfX.js": [
    { from: IMPORT, to: IMPORT + "\n" + M(1) + "import {enemyTracerShot as __aimEnemyTracerShot} from '/aim-tracers/enemy-shots.mjs';", marker: M(1) },
    { from: OLD_DRAW, to: NEW_DRAW, marker: M(2) },
  ],
};

// Everything is checked before anything is written: a changed bundle stops the script instead of patching it halfway.
const plan = [];
for (const dir of DIRS) for (const [name, edits] of Object.entries(FILES)) {
  const file = path.join(SITE, dir, name);
  let s = fs.readFileSync(file, "utf8");
  const done = edits.filter(e => s.includes(e.marker)).length;
  if (done === edits.length) { plan.push({ label: `${dir}/${name}`, file, text: null }); continue; }
  if (done !== 0) throw new Error(`${dir}/${name}: partly patched (${done}/${edits.length} markers)`);
  for (const e of edits) {
    const n = s.split(e.from).length - 1;
    if (n !== 1) throw new Error(`${dir}/${name}: anchor for ${e.marker} found ${n} times, expected 1: ${e.from.slice(0, 60)}`);
    s = s.replace(e.from, () => e.to);
  }
  plan.push({ label: `${dir}/${name}`, file, text: s });
}
for (const p of plan) {
  if (p.text === null) console.log(`${p.label}: already patched`);
  else { fs.writeFileSync(p.file, p.text); console.log(`${p.label}: patched`); }
}
