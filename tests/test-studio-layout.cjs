// Studio layout tools (app/studio/layout-tools.js): nudge, align, copy/paste, drill files, templates, lint, bot summary.
// The module is an ES module, so it is loaded with import().
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
  const T = await import(pathToFileURL(path.join(__dirname, "..", "app", "studio", "layout-tools.js")).href);
  const D = await import(pathToFileURL(path.join(__dirname, "..", "app", "studio", "drill.js")).href);
  let n = 0;
  const ok = (name, fn) => { fn(); n++; };

  const drillWith = (...items) => { const d = D.newDrill("range"); d.items.push(...items); return d; };

  ok("nudge follows the view turn", () => {
    assert.deepStrictEqual(T.nudgeDelta(1, 0, 0.5, 0), [0.5, 0]);
    assert.deepStrictEqual(T.nudgeDelta(0, -1, 1, 0), [0, -1]);
    // a quarter-turned view: screen right is some other world direction, and a turn then its inverse is the identity
    for (const q of [1, 2, 3]) {
      const [wx, wz] = T.nudgeDelta(1, 0, 1, q);
      const [sx, sz] = T.turnQ(wx, wz, q);
      assert.deepStrictEqual([Math.round(sx), Math.round(sz) + 0], [1, 0]);
    }
  });

  ok("shiftItem moves a bot with its route, spots, trigger and sound rule", () => {
    const b = D.newBot("peek", { x: 0, y: 0, z: 0 });
    b.spots = [{ x: 3, y: 0, z: 3 }];
    b.trigger = { a: { x: 1, z: 1 }, b: { x: 2, z: 2 } };
    b.soundRule = D.newSoundRule(b, { x: 0, y: 0, z: 10 });
    const before = JSON.stringify(b);
    T.shiftItem(b, 2, -1);
    assert.strictEqual(b.x, -2 + 2); // route[0] is x-2
    assert.strictEqual(b.route[1].z, -1);
    assert.deepStrictEqual(b.spots[0], { x: 5, y: 0, z: 2 });
    assert.deepStrictEqual(b.trigger.a, { x: 3, z: 0 });
    assert.strictEqual(b.soundRule.spot.x, 0);
    assert.notStrictEqual(JSON.stringify(b), before);
    T.shiftItem(b, -2, 1);
    assert.strictEqual(JSON.stringify(b), before);
  });

  ok("shiftItem keeps walls at their height and puts bots on the floor", () => {
    const w = D.newWall({ x: 0, y: 1, z: 0 });
    T.shiftItem(w, 1, 1, () => 9);
    assert.strictEqual(w.y, 1);
    const b = D.newBot("still", { x: 0, y: 1, z: 0 });
    T.shiftItem(b, 1, 1, () => 3);
    assert.strictEqual(b.y, 3);
    T.shiftItem(b, 1, 1, () => null);
    assert.strictEqual(b.y, 3);
  });

  ok("align and spread", () => {
    const a = { id: "a", x: 0, z: 0 }, b = { id: "b", x: 4, z: 3 }, c = { id: "c", x: 10, z: -2 };
    const left = T.alignDeltas([a, b, c], "left", 0);
    assert.deepStrictEqual(left.get("c"), [-10, 0]);
    assert.deepStrictEqual(left.get("a"), [0, 0]);
    const bottom = T.alignDeltas([a, b, c], "bottom", 0);
    assert.deepStrictEqual(bottom.get("a"), [0, 3]);
    const spread = T.alignDeltas([a, b, c], "spreadH", 0);
    assert.deepStrictEqual(spread.get("b"), [1, 0]); // 4 -> 5
    assert.strictEqual(T.alignDeltas([a], "left", 0).size, 0);
    // in a turned view "left" is still what the player sees as left
    const turned = T.alignDeltas([a, c], "left", 1);
    assert.ok(turned.get("a")[0] === 0 || turned.get("a")[1] !== 0 || turned.get("c")[0] !== 0);
  });

  ok("copy and paste remaps ids and trades", () => {
    const first = D.newBot("still", { x: 0, y: 0, z: 0 }), second = D.newBot("still", { x: 3, y: 0, z: 0 });
    second.tradeOf = first.id;
    const clip = T.parseClip(JSON.stringify(T.clipOf([first, second])));
    assert.ok(clip);
    const out = T.pasteItems(clip, { existing: [] });
    assert.strictEqual(out.length, 2);
    assert.notStrictEqual(out[0].id, first.id);
    assert.strictEqual(out[1].tradeOf, out[0].id);
    assert.strictEqual(out[0].x, 1.5);
    const placed = T.pasteItems(clip, { at: { x: 10, z: 10 } });
    assert.strictEqual(Math.round((placed[0].x + placed[1].x) / 2), 10);
    // a trade of something that is not in the clip is kept only if it exists in the drill
    const lone = T.clipOf([second]);
    assert.strictEqual(T.pasteItems(lone, { existing: [] })[0].tradeOf, null);
    assert.strictEqual(T.pasteItems(lone, { existing: [first] })[0].tradeOf, first.id);
    assert.strictEqual(T.parseClip("nonsense"), null);
    assert.strictEqual(T.parseClip(JSON.stringify({ format: "other", items: [] })), null);
  });

  ok("drill files round trip and reject junk", () => {
    const d = drillWith(D.newBot("strafe", { x: 1, y: 0, z: -5 }), D.newWall({ x: 0, y: 0, z: -3 }));
    d.name = "Test: drill/ one"; d.code = "abc"; d.compiled = 25;
    const text = T.exportDrillText(d);
    const back = T.parseDrillText(text);
    assert.ok(back.drill);
    assert.strictEqual(back.drill.code, undefined);
    assert.strictEqual(back.drill.items.length, 2);
    assert.strictEqual(back.drill.name, d.name);
    assert.ok(/^[\w\- ]+\.openvaim-drill\.json$/.test(T.fileName(d)));
    assert.ok(T.parseDrillText("{oops").error);
    assert.ok(T.parseDrillText("{}").error);
    assert.ok(T.parseDrillText(JSON.stringify({ items: [{ id: "x", kind: "bot", move: "teleport", x: 0, z: 0 }], round: {}, start: { x: 0, z: 0 } })).error);
    const bare = T.parseDrillText(JSON.stringify({ items: [], round: { goal: "clear" }, start: { x: 0, z: 1 } }));
    assert.ok(bare.drill && bare.drill.round.time === 60 && bare.drill.round.goal === "clear");
  });

  ok("every template builds valid items that the compiler accepts", () => {
    const start = { x: 0, y: 0, z: 8, facing: 0 };
    for (const t of T.TEMPLATES) {
      const out = T.buildTemplate(t.id, T.defaultAnchor(start), start);
      assert.ok(out.items.length, t.id);
      const ids = new Set(out.items.map((i) => i.id));
      assert.strictEqual(ids.size, out.items.length, `${t.id}: unique ids`);
      for (const i of out.items) assert.ok(Number.isFinite(i.x) && Number.isFinite(i.z), `${t.id}: coordinates`);
      const d = D.newDrill("range");
      d.start = { ...start };
      d.items.push(...out.items);
      Object.assign(d.round, out.round || {});
      assert.strictEqual(D.problems(d, null).filter((p) => !p.soft).length, 0, `${t.id}: no hard problems`);
      const { doc } = D.compile(d, null);
      assert.strictEqual(doc.schemaVersion, 2);
      // bots stand in front of the player (toward -z for facing 0)
      for (const b of out.items.filter((i) => i.kind === "bot")) assert.ok(b.z < start.z, `${t.id}: in front of you`);
    }
    assert.strictEqual(T.buildTemplate("nope", { x: 0, z: 0 }, { x: 0, z: 5 }), null);
  });

  ok("a trade template trades its first bot", () => {
    const out = T.buildTemplate("trade", { x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 8 });
    const [a, b] = out.items;
    assert.strictEqual(b.tradeOf, a.id);
  });

  ok("peek template is a real peek (cover behind the wall, spot in the open)", () => {
    const start = { x: 0, y: 0, z: 8, facing: 0 };
    const out = T.buildTemplate("jiggle", { x: 0, y: 0, z: -4 }, start);
    const p = out.items.find((i) => i.move === "peek");
    assert.strictEqual(p.route.length, 2);
    assert.ok(p.route[0].z < p.route[1].z, "cover is further from you than the peek spot");
    assert.ok(Math.hypot(p.route[0].x - p.route[1].x, p.route[0].z - p.route[1].z) > 0.3);
  });

  ok("lint finds the usual mistakes", () => {
    const d = D.newDrill("range");
    const a = D.newBot("still", { x: 0, y: 0, z: 7.5 });
    const b = D.newBot("still", { x: 0, y: 0, z: 7.5 });
    b.tradeOf = "gone"; b.tradeMin = 2; b.tradeMax = 1;
    const c = D.newBot("still", { x: 0, y: 0, z: -10 });
    c.delay = 100; c.shoots = "gold";
    const w = Object.assign(D.newWall({ x: 5, y: 0, z: 0 }), { length: 4, height: 2, turn: 0 });
    const e = D.newBot("still", { x: 5, y: 0, z: 0 });
    d.items.push(a, b, c, w, e);
    const text = T.lint(d).map((p) => p.text).join("\n");
    assert.ok(/right on top of your start/.test(text));
    assert.ok(/same spot/.test(text));
    assert.ok(/isn't there any more/.test(text));
    assert.ok(/shortest time is longer/.test(text));
    assert.ok(/never appears/.test(text));
    assert.ok(/stands inside/.test(text));
    for (const p of T.lint(d)) assert.strictEqual(p.soft, true);
    // a clean template-built drill has no warnings
    const clean = D.newDrill("range");
    clean.items.push(...T.buildTemplate("hold", T.defaultAnchor(clean.start), clean.start).items);
    assert.deepStrictEqual(T.lint(clean), []);
  });

  ok("describeBot reads in plain words", () => {
    const d = D.newDrill("range");
    const a = D.newBot("still", { x: 0, y: 0, z: -10 });
    const b = D.newBot("peek", { x: 3, y: 0, z: -10 });
    b.tradeOf = a.id; b.shoots = "gold";
    const c = D.newBot("still", { x: 6, y: 0, z: -10 });
    c.swingRadius = 8; c.swingOn = "damage"; c.swingChance = 50;
    d.items.push(a, b, c);
    const tb = T.describeBot(b, d).join(" ");
    assert.ok(/after you kill Holder 1/.test(tb) && /Peeks out/.test(tb) && /Gold/.test(tb), tb);
    const tc = T.describeBot(c, d).join(" ");
    assert.ok(/hurt or kill a bot within 8 m/.test(tc) && /50% of the time/.test(tc), tc);
    assert.ok(/doesn't shoot back/.test(T.describeBot(a, d).join(" ")));
    assert.deepStrictEqual(T.describeBot({ kind: "wall" }, d), []);
  });

  console.log(`${n} studio layout checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
