// Enemy shot tracer data (17 Nov 2026, marker aim-enemy-tracer): every "enemyShot" event now carries
//   origin    {x,y,z}  the shooter's eye point in metres (position + offset + eyeHeightStand), the same point the wall test uses
//   direction {x,y,z}  unit vector it fired along: toward the player's zone point (ME(zone)); for a miss, rotated by the
//                      yaw/pitch error the miss was rolled with
//   hitPoint  {x,y,z}  where the ray ends: the wall point when a wall stopped it (wall:"blocked"), else origin + direction * the
//                      distance to the player's aim point (the body point for a hit)
// All existing fields are unchanged and no random number is drawn, so results, replays and analytics see the same values.
//  1. BiMsX6Xn.js (enemy fire decision, three sites): remember the angular error rolled for the shot in e.pendingShotErr = [yaw, pitch] (radians).
//  2. CnrSARj_.js (hB, where the shot resolves): build origin/direction/hitPoint and spread them into the event.
// Usage: node tools/patch-enemy-shot-tracer.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const M = n => `/*aim-enemy-tracer-${n}*/`;

const BLOCK = M(1) + "let __aimEs={};try{const oX=G.position.x+G.offset.x,oY=G.position.y+G.offset.y+i.eyeHeightStand,oZ=G.position.z+G.offset.z,P=ME(x);" +
  "let dx=P.x-oX,dy=P.y-oY,dz=P.z-oZ;const D0=Math.hypot(dx,dy,dz);if(D0>1e-6){dx/=D0;dy/=D0;dz/=D0;const er=G.pendingShotErr;" +
  "if(G.pendingShotHit!==!0&&er){const yw=Math.atan2(dx,dz)+er[0],pt=Math.asin(Math.max(-1,Math.min(1,dy)))+er[1],cp=Math.cos(pt);dx=Math.sin(yw)*cp;dy=Math.sin(pt);dz=Math.cos(yw)*cp}" +
  "const r2=c8(t.projectile,t.shotSurfaces,oX,oY,oZ,dx,dy,dz,D0,t8*pB[QA].stopping),L=r2.stopT!==null?r2.stopT:D0;" +
  "__aimEs={origin:{x:oX,y:oY,z:oZ},direction:{x:dx,y:dy,z:dz},hitPoint:{x:oX+dx*L,y:oY+dy*L,z:oZ+dz*L}}}}catch{}";

const FILES = {
  "CnrSARj_.js": [
    { from: "const FA=wA?_g(QA,x,v)", to: BLOCK + "const FA=wA?_g(QA,x,v)", marker: M(1) },
    { from: "healthAfter:kA,...gA!==void 0?{wall:gA}:{}})", to: "healthAfter:kA,...gA!==void 0?{wall:gA}:{},..." + M(2) + "__aimEs})", marker: M(2) },
  ],
  "BiMsX6Xn.js": [
    { from: "Cc(U.yaw+V.yaw,U.pitch+V.pitch,v)&&(F+=1)", to: "(G===0&&(" + M(3) + "e.pendingShotErr=[U.yaw+V.yaw,U.pitch+V.pitch]),Cc(U.yaw+V.yaw,U.pitch+V.pitch,v)&&(F+=1))", marker: M(3) },
    { from: "Cc(V.yaw,V.pitch,v)&&(F+=1)", to: "(G===0&&(" + M(4) + "e.pendingShotErr=[V.yaw,V.pitch]),Cc(V.yaw,V.pitch,v)&&(F+=1))", marker: M(4) },
    { from: "e.pendingShotHit=Cc(R.yaw+F.yaw,R.pitch+F.pitch,v)", to: M(5) + "e.pendingShotErr=[R.yaw+F.yaw,R.pitch+F.pitch],e.pendingShotHit=Cc(R.yaw+F.yaw,R.pitch+F.pitch,v)", marker: M(5) },
    { from: "e.pendingShotHit=w.hit,", to: M(6) + "e.pendingShotErr=[w.offsetYaw,w.offsetPitch],e.pendingShotHit=w.hit,", marker: M(6) },
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
