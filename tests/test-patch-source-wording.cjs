// tools/patch-drill-source-wording.cjs: the shipped bundles are patched, and the script is safe to run again.
// Run: node tests/test-patch-source-wording.cjs
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "app", "site");
const DIRS = ["next/js", "_assets/r20261021-1/next/js"];
let passed = 0;
const test = (name, fn) => { fn(); passed++; };

test("both copies of both bundles carry every marker", () => {
  for (const dir of DIRS) {
    const round = fs.readFileSync(path.join(SITE, dir, "Hwnlm6zD.js"), "utf8");
    for (const n of [1, 2, 3]) assert.ok(round.includes(`/*aim-source-wording-${n}*/`), `${dir} Hwnlm6zD marker ${n}`);
    assert.ok(round.includes(String.raw`'Back\x20to\x20Target\x20Workshop'`) && !round.includes(String.raw`'Back\x20to\x20target\x20tasks'`));
    const pause = fs.readFileSync(path.join(SITE, dir, "OkAdunfX.js"), "utf8");
    for (const n of [5, 6]) assert.ok(pause.includes(`/*aim-source-wording-${n}*/`), `${dir} OkAdunfX marker ${n}`);
    assert.strictEqual(pause.split('"data-on":e.aimAids.summary!=="All off"').length - 1, 2);
  }
});

test("a second run changes nothing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aim-source-wording-"));
  try {
    for (const dir of DIRS) {
      fs.mkdirSync(path.join(tmp, dir), { recursive: true });
      for (const f of ["Hwnlm6zD.js", "OkAdunfX.js"]) fs.copyFileSync(path.join(SITE, dir, f), path.join(tmp, dir, f));
    }
    const out = execFileSync(process.execPath, [path.join(ROOT, "tools", "patch-drill-source-wording.cjs")], { env: { ...process.env, AIM_SITE_DIR: tmp }, encoding: "utf8" });
    assert.strictEqual(out.split("already patched").length - 1, 4, out);
    for (const dir of DIRS) for (const f of ["Hwnlm6zD.js", "OkAdunfX.js"]) {
      assert.ok(fs.readFileSync(path.join(tmp, dir, f)).equals(fs.readFileSync(path.join(SITE, dir, f))), `${dir}/${f} unchanged`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

console.log(`${passed} of ${passed} passed`);
