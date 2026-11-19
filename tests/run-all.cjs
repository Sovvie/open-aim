// Runs every test file in this folder, one after another: node tests/run-all.cjs
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const files = fs.readdirSync(__dirname).filter((f) => /^test-.*\.cjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop();
  console.log((r.status === 0 ? "ok    " : "FAIL  ") + f + "  " + last);
  if (r.status !== 0) failed++;
}
console.log(failed ? failed + " of " + files.length + " test files failed" : "all " + files.length + " test files passed");
process.exit(failed ? 1 : 0);
