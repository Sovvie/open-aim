// Tracking drills fire by themselves (19 Nov 2026, marker aim-autofire): in a scene scored "tracking" with hold-to-fire (the Target Workshop
// tracking drills and the game's own tracking scene) the weapon now fires the whole round, so the score is just time on target and you do
// not have to hold mouse button 1. A hit counts when the crosshair is on the target, a miss when it is not, exactly as when holding the button.
// One edit in the simulation (CnrSARj_.js, app/site/next/js and app/site/_assets/r20261021-1/next/js): the "fire is held" flag
//   og=c.fire&&!Pg   ->   og=(c.fire||A.rules.scoring==="tracking"&&A.rules.fireMode==="hold")&&!Pg
// Safe to run again. Usage: node tools/patch-tracking-autofire.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const MARK = "/*aim-autofire*/";
const FROM = "og=c.fire&&!Pg;og||(Ig=!1)";
const TO = "og=(c.fire||" + MARK + "A.rules.scoring===\"tracking\"&&A.rules.fireMode===\"hold\")&&!Pg;og||(Ig=!1)";
const plan = [];
for (const d of DIRS) {
  const file = path.join(SITE, d, "CnrSARj_.js"); let s = fs.readFileSync(file, "utf8");
  if (s.includes(MARK)) { plan.push({ file, text: null }); continue; }
  const n = s.split(FROM).length - 1;
  if (n !== 1) throw new Error(d + ": anchor found " + n + " times, expected 1");
  plan.push({ file, text: s.replace(FROM, () => TO) });
}
for (const p of plan) { if (p.text === null) console.log(p.file + ": already patched"); else { fs.writeFileSync(p.file, p.text); console.log(p.file + ": patched"); } }
