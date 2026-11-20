// Studio snapping guides (app/studio/snap.js) and the trigger dry run (app/studio/timeline.js).
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
  const load = (f) => import(pathToFileURL(path.join(__dirname, "..", "app", "studio", f)).href);
  const [Snap, TL, D, LT] = await Promise.all([load("snap.js"), load("timeline.js"), load("drill.js"), load("layout-tools.js")]);
  let n = 0;
  const ok = (name, fn) => { fn(); n++; };
  const bot = (move, x, z, over = {}) => Object.assign(D.newBot(move, { x, y: 0, z }), over);
  const drillWith = (...items) => { const d = D.newDrill("range"); d.start = { ...d.start, x: 0, z: 0, y: 0 }; d.items.push(...items); return d; };

  ok("snap: centre lines up with another bot inside the threshold", () => {
    const r = Snap.snapGuides({ x: 3.08, z: 7 }, [{ x: 3, z: 2 }], 0.15);
    assert.strictEqual(r.x, 3);
    assert.strictEqual(r.z, 7);
    assert.deepStrictEqual(r.guides, [{ axis: "x", v: 3, a: 2, b: 7 }]);
  });
  ok("snap: nothing near leaves the position alone", () => {
    const r = Snap.snapGuides({ x: 3.5, z: 7.5 }, [{ x: 3, z: 2 }], 0.15);
    assert.deepStrictEqual([r.x, r.z, r.guides.length], [3.5, 7.5, 0]);
    assert.deepStrictEqual(Snap.snapGuides({ x: 1, z: 1 }, [], 0.2).guides, []);
  });
  ok("snap: both axes at once, and edges of walls count", () => {
    const wall = { kind: "wall", x: 10, z: 0, y: 0, length: 4, height: 2, turn: 0, depth: 0.3 };
    const e = Snap.extentOf(wall);
    assert.ok(Math.abs(e.rx - 2) < 0.01 && Math.abs(e.rz - 0.15) < 0.01);
    const r = Snap.snapGuides({ x: 12.1, z: 5 }, [{ x: 10, z: 0, ...e }], 0.2); // right edge of the wall is x = 12
    assert.strictEqual(r.x, 12);
    const r2 = Snap.snapGuides({ x: 12.1, z: 0.1 }, [{ x: 10, z: 0, ...e }], 0.2);
    assert.strictEqual(r2.z, 0.15); // the wall's near edge is closer than its centre
    assert.strictEqual(r2.guides.length, 2);
  });
  ok("snap: a wide moving thing aligns its own edge; turned walls use the turned outline", () => {
    const r = Snap.snapGuides({ x: 5.9, z: 0, rx: 2, rz: 0.15 }, [{ x: 4, z: 3 }], 0.2); // its left edge 3.9 -> 4
    assert.strictEqual(r.x, 6);
    const e = Snap.extentOf({ kind: "wall", length: 4, height: 2, turn: 90, depth: 0.3 });
    assert.ok(e.rz > 1.9 && e.rx < 0.2);
    assert.deepStrictEqual(Snap.extentOf({ kind: "bot" }), { rx: 0, rz: 0 });
  });
  ok("snap: grid", () => {
    assert.strictEqual(Snap.toGrid(1.74), 1.5);
    assert.strictEqual(Snap.toGrid(1.76), 2);
  });

  ok("3D nudge follows the camera", () => {
    const eq = (a, b) => assert.deepStrictEqual(a.map((v) => v + 0), b);
    eq(Snap.cameraNudge(0, -1, 0.5, 0), [0, -0.5]); // camera behind the start looking -z: up is away
    eq(Snap.cameraNudge(1, 0, 0.5, 0), [0.5, 0]);
    eq(Snap.cameraNudge(0, -1, 1, Math.PI / 2), [-1, 0]); // turned a quarter: away is -x, right is -z
    eq(Snap.cameraNudge(1, 0, 1, Math.PI / 2), [0, -1]);
    eq(Snap.cameraNudge(0, 1, 1, Math.PI), [0, -1]); // facing the other way, "toward me" is -z
    eq(Snap.cameraNudge(0, -1, 0.5, 0.3), [0, -0.5]); // slightly turned: still the nearest axis
  });
  ok("timeline: plain delays are exact and ordered", () => {
    const a = bot("still", 0, 10, { delay: 3 }), b = bot("still", 2, 10, { delay: 0 });
    const r = TL.dryRun(drillWith(a, b));
    assert.deepStrictEqual(r.rows.map((x) => [x.id, x.t, x.exact]), [[b.id, 0, true], [a.id, 3, true]]);
  });
  ok("timeline: a trade comes after the bot it trades", () => {
    const a = bot("still", 0, 10, { delay: 2 }), b = bot("still", 3, 10, { tradeOf: null });
    b.tradeOf = a.id; b.tradeMin = 0.5; b.tradeMax = 1;
    const r = TL.dryRun(drillWith(a, b));
    const row = r.rows.find((x) => x.id === b.id);
    assert.strictEqual(row.type, "trade");
    assert.strictEqual(row.t, 2.5);
    assert.strictEqual(row.exact, false);
    assert.ok(r.rows.indexOf(row) > r.rows.findIndex((x) => x.id === a.id));
  });
  ok("timeline: a ring of trades never starts, a missing target never shows up", () => {
    const a = bot("still", 0, 10), b = bot("still", 3, 10);
    a.tradeOf = b.id; b.tradeOf = a.id;
    const r = TL.dryRun(drillWith(a, b));
    assert.ok(r.rows.every((x) => x.t === Infinity));
    assert.ok(r.notes.some((t) => /never happens/.test(t)));
    const c = bot("still", 0, 10, { tradeOf: "bot-gone" });
    assert.strictEqual(TL.dryRun(drillWith(c)).rows[0].t, Infinity);
  });
  ok("timeline: trigger line time depends on walking", () => {
    const a = bot("still", 0, 20, { delay: 1 });
    a.trigger = { a: { x: -3, z: 10 }, b: { x: 3, z: 10 } };
    const d = drillWith(a);
    d.round.move = true;
    const row = TL.dryRun(d).rows[0];
    assert.ok(Math.abs(row.t - (10 / D.SPEEDS.run + 1)) < 0.001);
    d.round.move = false;
    const stuck = TL.dryRun(d);
    assert.strictEqual(stuck.rows[0].t, Infinity);
    assert.ok(/can't walk/.test(stuck.rows[0].text));
  });
  ok("timeline: a swing waits for a bot in its radius; nobody in range means never", () => {
    const a = bot("still", 0, 10, { delay: 1 }), h = bot("still", 3, 10, { swingRadius: 5, swingOn: "kill", swingMin: 0.4, swingMax: 1 });
    let r = TL.dryRun(drillWith(a, h));
    assert.strictEqual(r.rows.find((x) => x.id === h.id).t, 1.4);
    h.swingRadius = 1;
    r = TL.dryRun(drillWith(a, h));
    assert.strictEqual(r.rows.find((x) => x.id === h.id).t, Infinity);
  });
  ok("timeline: sound area reach, and things after the round ends", () => {
    const h = bot("still", 0, 10);
    h.soundRule = D.newSoundRule(h, { x: 0, y: 0, z: 0 });
    h.soundRule.on = true; h.soundRule.area = { x0: -2, z0: 20, x1: 2, z1: 24 }; h.soundRule.delayMin = 0.5; h.soundRule.delayMax = 1;
    const d = drillWith(h);
    d.round.move = true; d.round.time = 3;
    const r = TL.dryRun(d);
    const row = r.rows.find((x) => x.id === h.id);
    assert.strictEqual(row.type, "sound");
    assert.ok(row.t > 3);
    assert.ok(r.notes.some((t) => /before the round ends/.test(t)));
  });
  ok("timeline: turn taking and smokes", () => {
    const a = bot("strafe", 0, 10), b = bot("strafe", 2, 10);
    const s = D.newSmoke({ x: 1, y: 0, z: 5 }); s.at = 2;
    const d = drillWith(a, b, s);
    d.round.order = "random"; d.round.gap = 1.5;
    const r = TL.dryRun(d);
    assert.ok(r.rows.filter((x) => x.type === "turn").length === 2);
    assert.strictEqual(r.rows.find((x) => x.type === "smoke").t, 2);
  });
  ok("timeline: every template and an empty drill give a sensible result", () => {
    assert.deepStrictEqual(TL.dryRun(drillWith()).rows, []);
    for (const t of LT.TEMPLATES) {
      const d = drillWith();
      const built = LT.buildTemplate(t.id, LT.defaultAnchor(d.start), d.start);
      d.items.push(...built.items);
      const r = TL.dryRun(d);
      assert.ok(r.rows.length >= built.items.filter((i) => i.kind === "bot").length, t.id);
    }
  });

  console.log(`test-studio-snap-timeline: ${n} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
