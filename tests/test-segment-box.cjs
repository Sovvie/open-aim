// segmentBox (analytics-recorder.js) was rewritten without allocations in 1.6.0; it must give bit-identical results to the 1.5.0 version.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app", "analytics-recorder.js"), "utf8").split("\r\n").join("\n");
const m = src.match(/  function pointBox\(p, box\) \{[\s\S]*?\n  \}\n[\s\S]*?(  function segmentBox\([\s\S]*?\n  \}\n)/);
assert(m, "pointBox/segmentBox not found");
const newSeg = new Function(m[0].replace(/^[\s\S]*?(?=  function pointBox)/, "") + "\nreturn segmentBox;")();

// The 1.5.0 version, verbatim.
function pointBox(p, box) {
  let q = 0;
  for (let i = 0; i < 3; i++) { const e = p[i] < box.min[i] ? box.min[i] - p[i] : p[i] > box.max[i] ? p[i] - box.max[i] : 0; q += e * e; }
  return Math.sqrt(q);
}
function oldSeg(o, d, tEnd, box) {
  const f = (t) => pointBox([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], box);
  let lo = 0, hi = tEnd;
  for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) <= f(m2)) hi = m2; else lo = m1; }
  let t = (lo + hi) / 2;
  const dist = f(t);
  if (dist < 1e-9) {
    const c = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
    t = Math.max(0, Math.min(tEnd, (c[0] - o[0]) * d[0] + (c[1] - o[1]) * d[1] + (c[2] - o[2]) * d[2]));
  }
  return { dist, t };
}
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const R = (a, b) => a + (b - a) * rnd();
const same = (a, b) => Object.is(a, b);
let n = 0;
for (let i = 0; i < 200000; i++) {
  const scale = [1, 10, 1000, 1e-3][i & 3];
  const min = [R(-5, 5) * scale, R(-5, 5) * scale, R(-5, 5) * scale];
  const box = { min, max: min.map((v) => v + R(0, 3) * scale) };
  const o = [R(-20, 20) * scale, R(-20, 20) * scale, R(-20, 20) * scale];
  const d = [R(-1, 1), R(-1, 1), R(-1, 1)];
  const tEnd = R(0, 80) * scale;
  const a = oldSeg(o, d, tEnd, box), b = newSeg(o, d, tEnd, box);
  assert(same(a.dist, b.dist) && same(a.t, b.t), "mismatch at " + i + " " + JSON.stringify([a, b]));
  n++;
}
// degenerate input
for (const v of [NaN, Infinity, -Infinity, 0]) {
  const box = { min: [0, 0, 0], max: [1, 1, 1] };
  const a = oldSeg([v, 0, 0], [1, 0, 0], 5, box), b = newSeg([v, 0, 0], [1, 0, 0], 5, box);
  assert(same(a.dist, b.dist) && same(a.t, b.t), "degenerate " + v);
}
console.log("segmentBox bit-identical to 1.5.0 over " + n + " random cases");
