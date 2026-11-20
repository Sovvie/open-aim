// Target Workshop lobby tab (app/target-workshop.js): the Easy / Hard reading of drill names.
// Run: node tests/test-target-workshop.cjs
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "app", "target-workshop.js"), "utf8");
const store = new Map();
const window = {
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
};
window.window = window;
const context = vm.createContext({ window, localStorage: window.localStorage, document: { querySelector: () => null }, CSS: { escape: (s) => s } });
vm.runInContext(src, context);
const { tierOf } = window.__aimTargetWorkshop;

let passed = 0;
function test(name, fn) { fn(); passed++; }

test("generated pairs: Easy- / Hard- prefix", () => {
  assert.deepStrictEqual({ ...tierOf("Easy-Flick — Gridshot 3×3") }, { tier: "easy", title: "Flick — Gridshot 3×3" });
  assert.deepStrictEqual({ ...tierOf("Hard-Counter-strafe — Stop and shoot") }, { tier: "hard", title: "Counter-strafe — Stop and shoot" });
});
test("suffix in brackets", () => {
  assert.deepStrictEqual({ ...tierOf("Corrode — A Corner, counter-strafe test (Easy)") }, { tier: "easy", title: "Corrode — A Corner, counter-strafe test" });
  assert.deepStrictEqual({ ...tierOf("Wide flicks [hard]") }, { tier: "hard", title: "Wide flicks" });
});
test("names without a tier stay as they are", () => {
  assert.deepStrictEqual({ ...tierOf("Grid shooting") }, { tier: null, title: "Grid shooting" });
  assert.deepStrictEqual({ ...tierOf("Easy targets for warm-up") }, { tier: null, title: "Easy targets for warm-up" });
  assert.deepStrictEqual({ ...tierOf("Hardpoint drill") }, { tier: null, title: "Hardpoint drill" });
  assert.deepStrictEqual({ ...tierOf(undefined) }, { tier: null, title: "" });
});
test("a 60-character name keeps all its text", () => {
  const name = "Hard-" + "Precision — Under movement with a very long extra label";
  const { tier, title } = tierOf(name);
  assert.strictEqual(tier, "hard");
  assert.strictEqual(title, name.slice(5));
});
test("every generated workshop drill reads as Easy or Hard", () => {
  const dir = path.join(__dirname, "..", "scenarios");
  const files = fs.readdirSync(dir).filter((f) => /^workshop-.*-(easy|hard)\.json$/.test(f));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const name = doc.item?.name ?? doc.name;
    const want = f.endsWith("-easy.json") ? "easy" : "hard";
    assert.strictEqual(tierOf(name).tier, want, `${f}: ${name}`);
  }
});

console.log(`${passed} of ${passed} passed`);
