// Enemy tracers in Original appearance mode (17 Nov 2026, marker aim-enemy-tracer-original): the enemy draw added by
// tools/patch-enemy-tracer-draw.cjs only ran while Custom mode was on (gate "c.customActive&&Be"), and the wrapper's
// shoot() dropped enemy shots whenever Custom was off. Now:
//   1. the enemyShot block builds the tracer shot whenever the shooter exists (the enemy "enabled" switch, frequency and
//      random settings are still applied inside aim-tracers/renderer.mjs);
//   2. shoot() sends every enemy shot to the aim-tracers renderer, in either mode; the player's shots still go to the
//      game's own tracers unless Custom is on, exactly as before;
//   3. renderWorld() also draws the renderer's overlay in Original mode (the renderer only holds enemy shots there).
// Needs the renderer.mjs change that lets shoot()/render() run in Original mode for enemy shots only.
// Usage: node tools/patch-enemy-tracer-original.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const M = n => `/*aim-enemy-tracer-original-${n}*/`;

const FILES = {
  "OkAdunfX.js": [
    { from: 'if(c.customActive&&Be){const __aimEs=__aimEnemyTracerShot(',
      to: M(1) + 'if(Be){const __aimEs=__aimEnemyTracerShot(', marker: M(1) },
    { from: 'if(__aimCustom.active){__aimCustom.shoot(x);return;}if(x.source==="enemy")return;',
      to: M(2) + 'if(__aimCustom.active||x.source==="enemy"){__aimCustom.shoot(x);return;}', marker: M(2) },
    { from: 'if(__aimCustom.active){__aimCustom.render(x,z);return;}if(!(i||!r||!r.enabled)){',
      to: 'if(__aimCustom.active){__aimCustom.render(x,z);return;}' + M(3) + '__aimCustom.render(x,z);if(!(i||!r||!r.enabled)){', marker: M(3) },
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
