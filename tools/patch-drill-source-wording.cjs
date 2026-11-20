// Drill source wording (20 Nov 2026, marker aim-source-wording): the in-round screens of the compiled game named every
// workshop drill as VALORANT Training, and called every drill a "custom scene". Both copies of each bundle are patched
// (app/site/next/js and app/site/_assets/r20261021-1/next/js). Text and one chip state only, no behaviour changes.
// Hwnlm6zD.js (round screen):
//   1. Result screen button: a Target Workshop drill said "Back to VALORANT Training"; it now says "Back to Target Workshop".
//   2. Result screen heading: a Target Workshop drill said "VALORANT Training · Complete"; now "Target Workshop · Complete".
//   3. Pause menu line under the drill name: "Custom scene · Rules and duration come from the scene file" showed on every
//      VALORANT Training and Target Workshop drill. It now names where the drill comes from (VALORANT Training,
//      Target Workshop, Community Workshop, review playtest) and keeps the old text for a real custom scene file.
//   4. Start screen button for Target Workshop: "Back to target tasks" -> "Back to Target Workshop" (the lobby tab's name).
// OkAdunfX.js (pause menu and Tab menu):
//   5, 6. The "Pre-aim aids" chip gets data-on="true" while any aid is on (summary is not "All off"), so ui.css colours it
//      red like the Pause timer switch's "On" chip (it stayed grey). Vue flags: TEXT | PROPS with ["data-on"].
// Each edit leaves a /*aim-source-wording-N*/ marker. Safe to run again ("already patched"); every anchor must occur
// exactly once, and nothing is written unless all edits fit.
// Usage: node tools/patch-drill-source-wording.cjs   (AIM_SITE_DIR=<copy of app/site> runs it on a scratch copy)
const fs = require("fs"), path = require("path");
const SITE = process.env.AIM_SITE_DIR || path.join(__dirname, "..", "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
const M = (n) => `/*aim-source-wording-${n}*/`;

// String.raw: the bundle writes spaces as \x20 inside some strings; these must stay literal backslash sequences.
const aidsChip = (v) => ({
  from: `S("span",${v},J(e.aimAids.summary),1)`,
  to: `S("span",{class:"al-pause-timer-state","data-on":e.aimAids.summary!=="All off"?"true":null},J(e.aimAids.summary),9,["data-on"])`,
});
const EDITS = [
  { file: "Hwnlm6zD.js", from: String.raw`cm=bf(()=>cf['value']?'Back to VALORANT Training':`,
    to: String.raw`cm=bf(()=>ck['value']?'Back to Target Workshop':cf['value']?'Back to VALORANT Training':` },
  { file: "Hwnlm6zD.js", from: String.raw`cB=bf(()=>cf['value']?'VALORANT Training · Complete':`,
    to: String.raw`cB=bf(()=>ck['value']?'Target Workshop · Complete':cf['value']?'VALORANT Training · Complete':` },
  { file: "Hwnlm6zD.js", from: String.raw`cN=bf(()=>cf['value']?'Custom\x20scene\x20·\x20Rules\x20and\x20duration\x20come\x20from\x20the\x20scene\x20file':'')`,
    to: String.raw`cN=bf(()=>{const dE=cf['value'];if(!dE)return'';const dF=dE['source']==='workshop'?(dE['workshop']?.['type']==='ball'?'Target\x20Workshop':'VALORANT\x20Training'):dE['source']==='pw'?'Community\x20Workshop':dE['source']==='review'?'Review\x20playtest':null;return dF?dF+'\x20·\x20Rules\x20and\x20duration\x20come\x20with\x20the\x20drill':'Custom\x20scene\x20·\x20Rules\x20and\x20duration\x20come\x20from\x20the\x20scene\x20file';})` },
  { file: "Hwnlm6zD.js", from: String.raw`'Back\x20to\x20target\x20tasks'`, to: String.raw`'Back\x20to\x20Target\x20Workshop'`, bare: true },
  { file: "OkAdunfX.js", ...aidsChip("hw") },
  { file: "OkAdunfX.js", ...aidsChip("Rw") },
].map((e, i) => ({ ...e, marker: M(i + 1) }));

// The marker sits as a comment just before the edited declaration or call (inside a string there is no room for one).
const withMarker = (e) => (e.bare ? e.to : e.marker + e.to);

const plan = [];
for (const dir of DIRS) {
  for (const name of [...new Set(EDITS.map((e) => e.file))]) {
    const file = path.join(SITE, dir, name);
    let s = fs.readFileSync(file, "utf8");
    const label = path.relative(SITE, file).replace(/\\/g, "/");
    let changed = false;
    for (const e of EDITS.filter((x) => x.file === name)) {
      const to = withMarker(e);
      if (s.includes(to)) continue; // already patched
      const n = s.split(e.from).length - 1;
      if (n !== 1) throw new Error(`${label}: anchor for ${e.marker} found ${n} times, expected 1: ${e.from.slice(0, 70)}`);
      s = s.replace(e.from, () => to);
      changed = true;
    }
    plan.push({ label, file, text: changed ? s : null });
  }
}
for (const p of plan) {
  if (p.text === null) console.log(`${p.label}: already patched`);
  else { fs.writeFileSync(p.file, p.text); console.log(`${p.label}: patched`); }
}
