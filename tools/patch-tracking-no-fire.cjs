// Tracking drills need no shooting (19 Nov 2026, marker aim-trackcover): in a scene scored "tracking" the time on target is counted every frame
// from where the crosshair points, whether or not the fire button is held. The game only counted a frame while the button was down, so the
// Target Workshop tracking drills made you hold mouse button 1 (and the first version of this patch fired for you, which still did not count
// the hits). Nothing fires now: no shots, tracers or sounds, just the crosshair on the target.
//  1. OkAdunfX.js (the game's client engine; app/site/next/js and app/site/_assets/r20261021-1/next/js), the per-frame scoring function:
//       if(...,!o||!y.fire)return;l.frames++;...   ->   if(...,!o)return;l.frames++;...        (o = the scene is scored "tracking")
//     "covered" (a frame where the aim ray hits the target) over "frames" is the coverage and the score, so they now count every frame.
//  2. CnrSARj_.js (the simulation): takes out the earlier auto-fire edit (marker aim-autofire) if it is there.
// Safe to run again. Usage: node tools/patch-tracking-no-fire.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const MARK = "/*aim-trackcover*/";
const COVER_FROM = "l.jerk+=Math.abs(_-d),d=_,!o||!y.fire)return;l.frames++";
const COVER_TO = "l.jerk+=Math.abs(_-d),d=_," + MARK + "!o)return;l.frames++";
const FIRE_TO = "og=c.fire&&!Pg;og||(Ig=!1)";
const FIRE_FROM = "og=(c.fire||/*aim-autofire*/A.rules.scoring===\"tracking\"&&A.rules.fireMode===\"hold\")&&!Pg;og||(Ig=!1)";
const plan = [];
function edit(file, from, to, done) {
  let s = fs.readFileSync(file, "utf8");
  if (done(s)) { plan.push({ file, text: null }); return; }
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(file + ": anchor found " + n + " times, expected 1");
  plan.push({ file, text: s.replace(from, () => to) });
}
for (const d of DIRS) {
  edit(path.join(SITE, d, "OkAdunfX.js"), COVER_FROM, COVER_TO, (s) => s.includes(MARK));
  edit(path.join(SITE, d, "CnrSARj_.js"), FIRE_FROM, FIRE_TO, (s) => !s.includes("aim-autofire"));
}
for (const p of plan) { if (p.text === null) console.log(p.file + ": nothing to do"); else { fs.writeFileSync(p.file, p.text); console.log(p.file + ": patched"); } }
