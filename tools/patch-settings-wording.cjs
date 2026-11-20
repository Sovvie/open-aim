// Settings wording (20 Nov 2026, marker aim-settings-wording): plain sentence-case labels and clearer hints on the lobby
// Settings page, in the game's settings bundle Dc2Dm9E6.js (app/site/next/js and app/site/_assets/r20261021-1/next/js).
// Text only (no setting, key or behaviour changes), plus one settings-search entry for the Interface row.
//   - "Keep Player Centered", "Vision Cones", "Show Map Region Names", "Wall Spray": Title Case among sentence-case labels.
//   - "Show Inner lines" / "Show Outer lines" (crosshair): the toggle label lower-cases the section name.
//   - The minimap note ("Other Pre-aim aids can be controlled from ...") and the Kill icons hint read as plain English.
// Each edit leaves a /*aim-settings-wording-N*/ marker. Safe to run again ("already patched"); every anchor must occur
// exactly once, and nothing is written unless all edits fit.
// Usage: node tools/patch-settings-wording.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const M = (n) => `/*aim-settings-wording-${n}*/`;

const EDITS = [
  { from: "'label':'Keep Player Centered','hint':'On follows your position; Off shows the full map'",
    to: "'label':'Keep player centered','hint':'On: the map follows your position. Off: it shows the whole map'" },
  { from: "'label':'Vision Cones'", to: "'label':'Vision cones'" },
  { from: "'label':'Show Map Region Names','hint':'Show location labels on the large map'",
    to: "'label':'Show map region names','hint':'Show place names on the big map'" },
  { from: "'label':'Wall Spray'", to: "'label':'Wall spray'" },
  { from: "'toggle':'Show\\x20'+d4,", to: "'toggle':'Show\\x20'+String(d4).toLowerCase()," },
  { from: "' Bot positions appear when the task provides enemy markers. Other Pre-aim aids can be controlled from the start screen, TAB menu or pause menu. '",
    to: "' Bot positions show only when the task has enemy markers. The other pre-aim aids are on the start screen, the Tab menu and the pause menu. '" },
  // The settings search knew nothing about the Interface row (Enhanced / Performance) that interface-mode.js adds
  // under Video > Smoothness, so "performance", "blur" or "interface" found nothing. One search entry for it,
  // pointing at the row's data-setting="esUiMode".
  { from: "{'id':'lowLatency','tab':'video','section':'Smoothness',",
    to: "{'id':'esUiMode','tab':'video','section':'Smoothness','label':'Interface (Enhanced or Performance)','syn':['interface','performance','enhanced','blur','glass','animations','effects','ui mode','look']},{'id':'lowLatency','tab':'video','section':'Smoothness'," },
  // Weapon skins moved from Visuals to Collection; the Audio note still sent players to the Visuals tab.
  { from: "'Gunshot and kill sounds come from your weapon skins (Visuals tab).'",
    to: "'Gunshot and kill sounds come from your weapon skins (Collection, in the top bar).'" },
  // Inside a string: no room for a marker comment; the new text itself shows it is done.
  { from: "Its style follows the Enemy kill sound set; Same as hit sound shows none.",
    to: "Its style follows your kill sound; with \"Same as hit sound\" no icon shows.", bare: true },
].map((e, i) => ({ ...e, marker: M(i + 1) }));

// The marker sits as a comment just before the edited property or argument.
const withMarker = (e) => (e.bare ? e.to : e.marker + e.to);

const plan = [];
for (const dir of DIRS) {
  const file = path.join(SITE, dir, "Dc2Dm9E6.js");
  let s = fs.readFileSync(file, "utf8");
  const label = path.relative(SITE, file).replace(/\\/g, "/");
  let changed = false;
  for (const e of EDITS) {
    const to = withMarker(e);
    if (s.includes(to)) continue; // already patched
    const n = s.split(e.from).length - 1;
    if (n !== 1) throw new Error(`${label}: anchor for ${e.marker} found ${n} times, expected 1: ${e.from.slice(0, 70)}`);
    s = s.replace(e.from, () => to);
    changed = true;
  }
  plan.push({ label, file, text: changed ? s : null });
}
for (const p of plan) {
  if (p.text === null) console.log(`${p.label}: already patched`);
  else { fs.writeFileSync(p.file, p.text); console.log(`${p.label}: patched`); }
}
