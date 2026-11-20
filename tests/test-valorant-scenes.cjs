// Test for the Valorant Workshop scenarios (tools/make-valorant-scenes.mjs and scenarios/valorant-*.json). Run: node test-valorant-scenes.cjs
// Checks every generated scenario as far as the game's own checks can be reproduced:
//  - the committed files are exactly what the generator makes (it is deterministic)
//  - item / scene fields, unique names and share codes (also against every other scenario), sort 300-399, sibling pairs
//  - the game's own scene validator (app/site/next/js/D_iGclxB.js, the "Not a valid scene file" check) accepts each doc
//  - positions are finite numbers and stand on the map's walkable floor (app/studio/map-data.js, the Studio's own floor data)
//  - spawners and dispatcher routes name actor templates that exist, behaviours are known, trigger fields point at real actors
//  - round 2: bots stand on real floor (not over a box top the scenario does not have), the player can see where each bot (not a sound-gated
//    lurker) shows up, lurkers are really behind the player, off-angle chains and trade pairs have the structure their names promise,
//    and the 30 round-1 scenarios keep their names, share codes and sort numbers
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const SCEN = path.join(ROOT, "scenarios");
const KNOWN_BEHAVIORS = ["replay", "strafe", "sway", "jump", "path", "cross", "shooter", "respawn", "blink", "decay"]; // `et` in the game validator
const HEAR_SOURCES = ["shot", "footstep", "land"];
// Round 1 (sort, share code, name): these must never change.
const ROUND1 = [
  [300,"0a4f1580bb95603f","Sunset — Wide-swing duel (Easy)"],
  [301,"621c797a8c125103","Sunset — Wide-swing duel (Hard)"],
  [302,"50502c7246533aa3","Sunset — Jiggle bait (Easy)"],
  [303,"ee4211ee5e40c6f0","Sunset — Jiggle bait (Hard)"],
  [304,"defd98e5275a319b","Sunset — Crossfire and trade (Easy)"],
  [305,"6efd70822b3a6717","Sunset — Crossfire and trade (Hard)"],
  [306,"5db7d0c3bef3a337","Sunset — A site, clear in order (Easy)"],
  [307,"a88c5035db4d3b6b","Sunset — A site, clear in order (Hard)"],
  [308,"1bab9082e0631635","Sunset — A site, they swing on sound (Easy)"],
  [309,"2485b356d72afe77","Sunset — A site, they swing on sound (Hard)"],
  [310,"fe2d962776efec53","Sunset — A site, spray transfer (Easy)"],
  [311,"2f130f0001e22fbc","Sunset — A site, spray transfer (Hard)"],
  [312,"b0231054306b0014","Ascent — Mid, Operator hold (Easy)"],
  [313,"7058fa2ec2e8787f","Ascent — Mid, Operator hold (Hard)"],
  [314,"6fbe7502e3eb25f1","Ascent — Mid, Marshal quick-scope"],
  [315,"82502e803af13f27","Ascent — Dock, flash timing (Easy)"],
  [316,"c6fd3a9ca4b25d9c","Ascent — Dock, flash timing (Hard)"],
  [317,"abb2d0f8a48e9927","Haven — A site, flash and swing (Easy)"],
  [318,"f53eaff69e001b56","Haven — A site, flash and swing (Hard)"],
  [319,"d567b6e26c77ed21","Haven — C Long, sniper duel (Easy)"],
  [320,"ef2eb6c65d50511e","Haven — C Long, sniper duel (Hard)"],
  [321,"f4feb8ab9013da1a","Bind — A Lamps, dry peek (Easy)"],
  [322,"155ed45a48a5dbd2","Bind — A Lamps, dry peek (Hard)"],
  [323,"ad721043c2e5b24a","Corrode — A Corner, counter-strafe test (Easy)"],
  [324,"c40a281d1337c5d3","Corrode — A Corner, counter-strafe test (Hard)"],
  [325,"04c4214e80bc99fd","Split — B retake, staggered defenders (Easy)"],
  [326,"c6fec8b576e3e154","Split — B retake, staggered defenders (Hard)"],
  [327,"a95041df2d7530a5","Lotus — C Long, two-angle crossfire (Easy)"],
  [328,"04b1d6019da50daf","Lotus — C Long, two-angle crossfire (Hard)"],
  [329,"9e2726858fd1fc9e","Summit — B Main, lurk timing"],
];
const FLASH_AGENTS = ["phoenix", "kayo", "reyna", "breach", "skye", "yoru", "vyse"];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const docOf = (data) => (typeof data.scene.doc === "string" ? JSON.parse(data.scene.doc) : data.scene.doc);

// every {x, y, z} (or x/z only) number in a doc must be finite
function walkNumbers(value, trail, bad) {
  if (typeof value === "number") { if (!Number.isFinite(value)) bad.push(trail); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => walkNumbers(v, trail + "[" + i + "]", bad)); return; }
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walkNumbers(v, trail + "." + k, bad);
}

async function main() {
  const gen = await import(pathToFileURL(path.join(ROOT, "tools", "make-valorant-scenes.mjs")).href);
  const kitMod = await import(pathToFileURL(path.join(ROOT, "tools", "valorant-map-kit.mjs")).href);
  const gameCheck = await kitMod.loadGameCheck();

  // ---- the files are what the generator makes
  const built = await gen.buildAll();
  const files = fs.readdirSync(SCEN).filter((f) => f.startsWith(gen.FILE_PREFIX) && f.endsWith(".json")).sort();
  assert.deepStrictEqual(files, built.map((b) => b.file).sort(), "scenarios/valorant-*.json differ from the generator's list: run node tools/make-valorant-scenes.mjs");
  for (const b of built) {
    const onDisk = readJson(path.join(SCEN, b.file));
    assert.deepStrictEqual(onDisk, JSON.parse(JSON.stringify(b.data)), b.file + " is out of date: run node tools/make-valorant-scenes.mjs");
  }
  assert.ok(files.length >= 70, "expected 70 or more Workshop scenarios, got " + files.length);
  // sort numbers run 300, 301, ... without gaps, in generator order; round 1 keeps its names, codes and numbers
  built.forEach((b, i) => assert.strictEqual(b.data.item.sort, 300 + i, b.file + " sort"));
  for (const [sort, code, name] of ROUND1) {
    const b = built.find((x) => x.data.item.sort === sort);
    assert.ok(b && b.data.item.name === name && b.data.item.shareCode === code, "round-1 scenario " + sort + " (" + name + ") changed name or share code");
  }

  // ---- every other scenario, to catch name / code collisions
  const others = fs.readdirSync(SCEN).filter((f) => f.endsWith(".json") && !files.includes(f)).map((f) => readJson(path.join(SCEN, f)).item);
  const names = new Set(others.map((i) => i.name)), codes = new Set(others.map((i) => i.shareCode));
  const kits = {};
  const stats = { maps: new Set(), swing: 0, hear: 0, trade: 0, flash: 0, sniper: 0, types: new Set(), easy: 0, hard: 0 };

  for (const file of files) {
    const data = readJson(path.join(SCEN, file)), { item, scene } = data, doc = docOf(data);
    const at = (msg) => file + ": " + msg;
    assert.ok(/^valorant-[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(file), at("file name"));
    // item and scene fields (the same rules as scripts/build-scenarios.mjs)
    for (const key of ["name", "description"]) assert.ok(typeof item[key] === "string" && item[key].trim(), at("item." + key));
    assert.ok(item.description.length <= 400, at("description is short enough for the lobby card"));
    assert.ok(/^[0-9a-f]{16}$/.test(item.shareCode), at("shareCode"));
    assert.strictEqual(item.shareCode, gen.shareCodeOf(item.name), at("shareCode is the documented sha1 of the name"));
    assert.strictEqual(item.sceneKey, "set-" + item.shareCode, at("sceneKey"));
    assert.strictEqual(scene.shareCode, item.shareCode, at("scene.shareCode"));
    assert.strictEqual(scene.name, item.name, at("scene.name"));
    assert.ok(item.sort >= 300 && item.sort <= 399, at("sort in 300-399"));
    assert.ok(!/\s{2,}/.test(item.description), at("description spacing"));
    assert.ok(["hold", "flash"].includes(item.type), at("type is hold or flash, got " + item.type));
    assert.ok(typeof item.mapId === "string" && (kitMod.MAPS_WITH_DATA.includes(item.mapId) || kitMod.MAPS_WITHOUT_DATA.includes(item.mapId)), at("map " + item.mapId + " is a map of the app"));
    assert.strictEqual(scene.schemaVersion, 2, at("schemaVersion"));
    assert.strictEqual(scene.blockCount, doc.blocks.length, at("blockCount"));
    assert.strictEqual(item.docBytes, Buffer.byteLength(JSON.stringify(doc), "utf8"), at("docBytes"));
    assert.ok(!names.has(item.name), at("name is unique: " + item.name)); names.add(item.name);
    assert.ok(!codes.has(item.shareCode), at("shareCode is unique")); codes.add(item.shareCode);
    stats.maps.add(item.mapId); stats.types.add(item.type);
    if (file.endsWith("-easy.json")) stats.easy++;
    if (file.endsWith("-hard.json")) stats.hard++;

    // the game's own check
    assert.doesNotThrow(() => gameCheck(JSON.stringify(doc)), at("the game's scene check"));
    assert.strictEqual(doc.environment.map, item.mapId, at("environment.map matches mapId"));

    // numbers and positions
    const bad = [];
    walkNumbers(doc, "doc", bad);
    assert.deepStrictEqual(bad, [], at("non-finite numbers at " + bad.join(", ")));
    const kit = kits[item.mapId] || (kits[item.mapId] = kitMod.MAPS_WITHOUT_DATA.includes(item.mapId) ? kitMod.loadPointKit(item.mapId, gen.pointsOnMap(item.mapId)) : await kitMod.loadMapKit(item.mapId));
    // a bot stands on a real floor: the game drops a spawner (0.3 m above its floor) onto what is under it, so a spot over a box top that this scenario does not contain would end up on the floor below
    const realFloor = (p, lift, tol) => (kit.dataless ? kit.standsOn({ x: p.x, y: p.y - lift, z: p.z }) : kit.levelsAt(p.x, p.z).some((l) => Math.abs(p.y - lift - l) <= tol));
    const stand = (p, what) => assert.ok(kit.standsOn(p), at(`${what} (${p.x}, ${p.y}, ${p.z}) is not on the walkable floor of ${item.mapId}`));
    stand(doc.playerSpawn.position, "player start");

    // actors, spawners, dispatchers
    const actorIds = new Set(doc.actors.map((a) => a.id));
    assert.strictEqual(actorIds.size, doc.actors.length, at("unique actor ids"));
    assert.ok(doc.actors.length >= 1, at("has bots"));
    for (const a of doc.actors) {
      assert.strictEqual(a.body.shape, "humanoid", at(a.id + " is a humanoid bot"));
      assert.ok(a.behaviors.length > 0, at(a.id + " has behaviours"));
      for (const b of a.behaviors) assert.ok(KNOWN_BEHAVIORS.includes(b.kind), at(`${a.id} has unknown behaviour ${b.kind}`));
      const shooter = a.behaviors.find((b) => b.kind === "shooter");
      assert.ok(shooter && shooter.reaction[0] > 0 && shooter.reaction[1] >= shooter.reaction[0], at(a.id + " shoots back with a sane reaction time"));
      if (a.body.weapon && /^(operator|marshal|outlaw|tourdeforce)$/.test(a.body.weapon)) stats.sniper++;
      for (const b of a.behaviors) {
        for (const w of b.waypoints || []) stand(w, a.id + " route");
        for (const f of b.flashStops || []) {
          stats.flash++;
          assert.ok(FLASH_AGENTS.includes(f.agent || "phoenix"), at(a.id + " flash agent"));
          assert.ok(f.at >= 1 && f.at < b.waypoints.length, at(a.id + " flash stop points at a route point"));
          assert.ok(Number.isFinite(f.target.x) && f.wait >= 0, at(a.id + " flash target and wait"));
        }
      }
    }
    for (const s of doc.spawners) {
      assert.ok(actorIds.has(s.actorTemplateId), at(`spawner ${s.id} names a missing actor ${s.actorTemplateId}`));
      stand({ x: s.position.x, y: s.groundSnap ? s.position.y - 0.3 : s.position.y, z: s.position.z }, "spawner " + s.id);
      assert.ok(realFloor(s.position, s.groundSnap ? 0.3 : 0, 0.2), at("spawner " + s.id + " (" + s.position.x + ", " + s.position.y + ", " + s.position.z + ") is not over a real floor of " + item.mapId));
      if (s.afterKill) {
        stats.trade++;
        assert.ok(s.afterKill.some((id) => actorIds.has(id)), at(`spawner ${s.id} trades on a kill of an actor that exists`));
        assert.ok(s.afterKill.every((id) => /^actor-\d+(-spot\d+)?$/.test(id)), at("afterKill ids"));
      }
    }
    const ids = new Set([...doc.spawners.map((s) => s.id), ...(doc.dispatchers || []).map((d) => d.id)]);
    assert.strictEqual(ids.size, doc.spawners.length + (doc.dispatchers || []).length, at("unique spawner / dispatcher ids"));
    for (const d of doc.dispatchers || []) {
      assert.ok(d.routes.length >= 1, at(d.id + " has routes"));
      for (const r of d.routes) {
        assert.ok(actorIds.has(r.templateId), at(`dispatcher ${d.id} names a missing actor ${r.templateId}`));
        if (r.at) {
          stand(r.at, "dispatcher " + d.id);
          assert.ok(realFloor(r.at, 0, 0.2), at("dispatcher " + d.id + " spot (" + r.at.x + ", " + r.at.y + ", " + r.at.z + ") is not on a real floor of " + item.mapId));
        }
      }
      if (d.afterKill) { stats.trade++; assert.ok(d.afterKill.some((id) => actorIds.has(id)), at(d.id + " trade target exists")); }
      if (d.swing) {
        stats.swing++;
        assert.ok(d.swing.radius > 0 && d.swing.radius <= 100, at(d.id + " swing radius"));
        assert.ok(["kill", "damage"].includes(d.swing.on), at(d.id + " swing event"));
        assert.ok(d.swing.delay[0] >= 0 && d.swing.delay[1] >= d.swing.delay[0], at(d.id + " swing delay"));
        assert.ok(d.swing.swingChance > 0 && d.swing.swingChance <= 1, at(d.id + " swing chance is 0-1"));
        stand(d.swing.at, d.id + " swing centre");
        // the trigger must be able to fire: some other bot of this scenario is within the radius of the centre
        const near = (doc.dispatchers || []).concat(doc.spawners.map((s) => ({ routes: [{ at: s.position }] }))).some((o) => o !== d && o.routes.some((r) => r.at && Math.hypot(r.at.x - d.swing.at.x, r.at.z - d.swing.at.z) <= d.swing.radius));
        const waypointNear = doc.actors.some((a) => a.id !== d.routes[0].templateId && a.behaviors.some((b) => (b.waypoints || []).some((w) => Math.hypot(w.x - d.swing.at.x, w.z - d.swing.at.z) <= d.swing.radius)));
        assert.ok(near || waypointNear, at(d.id + ": no other bot is inside the swing radius, so the trigger could never fire"));
      }
      if (d.hear) {
        stats.hear++;
        const a = d.hear.area;
        assert.ok(a.x1 > a.x0 && a.z1 > a.z0, at(d.id + " sound area has size"));
        assert.ok(d.hear.sources.length > 0 && d.hear.sources.every((k) => HEAR_SOURCES.includes(k)), at(d.id + " sound sources"));
        assert.ok(d.hear.delay[1] >= d.hear.delay[0] && d.hear.swingChance > 0 && d.hear.swingChance <= 1, at(d.id + " hear delay / chance"));
        // the player must be able to make the sound inside the area: the start is in it
        const p = doc.playerSpawn.position;
        assert.ok(p.x >= a.x0 && p.x <= a.x1 && p.z >= a.z0 && p.z <= a.z1, at(d.id + " sound area contains the player start"));
        assert.strictEqual(doc.rules.playerMovable, true, at("footsteps need a movable player"));
      }
    }
  }

  // ---- round 2 structure (reads the committed files)
  for (const file of files) {
    const data = readJson(path.join(SCEN, file)), doc = docOf(data), item = data.item;
    const kit = kits[item.mapId];
    const at = (msg) => file + ": " + msg;
    const start = doc.playerSpawn.position, yaw = doc.playerSpawn.yaw;
    const bearingOf = (p) => { const d = ((Math.atan2(-(p.x - start.x), -(p.z - start.z)) - yaw) * 180) / Math.PI; return ((d % 360) + 540) % 360 - 180; };
    const movement = (a) => a.behaviors.find((b) => b.kind === "cross" || (b.kind === "path" && b.waypoints && b.waypoints.length > 1)); // a peeker is a cross route, or a path when it strafes at the peek
    const gated = new Set();
    for (const d of doc.dispatchers || []) if (d.hear) for (const r of d.routes) gated.add(r.templateId);
    const showSpot = (a) => {
      const cross = movement(a);
      if (cross) { const fl = cross.flashStops && cross.flashStops[0]; return cross.waypoints[Math.min(cross.waypoints.length - 1, fl ? fl.at + 1 : 1)]; }
      const s = doc.spawners.find((x) => x.actorTemplateId === a.id);
      if (s) return { x: s.position.x, y: s.groundSnap ? s.position.y - 0.3 : s.position.y, z: s.position.z };
      return (doc.dispatchers || []).flatMap((d) => d.routes).find((r) => r.templateId === a.id && r.at).at;
    };
    // the player can see where every bot that is not sound-gated shows up (with a small margin for a hairline gap)
    if (!kit.dataless) for (const a of doc.actors) {
      if (gated.has(a.id)) continue;
      const p = showSpot(a);
      assert.ok(kit.sees(start, p) && kit.sees({ ...start, y: start.y + 0.05 }, p), at("the player cannot see where " + a.id + " shows up (" + p.x + ", " + p.y + ", " + p.z + ")"));
    }
    // the player faces its enemies: the middle of the bots that are not sound-gated is within 70 degrees of the facing (Summit's rotators cross a lane)
    const shown = doc.actors.filter((a) => !gated.has(a.id)).map(showSpot);
    if (shown.length && !/summit-b-main-rotators/.test(file)) {
      const mean = shown.reduce((a, p) => a + bearingOf(p), 0) / shown.length;
      assert.ok(Math.abs(mean) <= 70, at("the bots are not in front of the player (mean bearing " + Math.round(mean) + ")"));
    }
    const afterKills = [...doc.spawners, ...(doc.dispatchers || [])].filter((x) => x.afterKill);
    if (/lurk-from-behind/.test(file)) {
      const behind = doc.actors.filter((a) => gated.has(a.id)).map((a) => movement(a).waypoints[1]);
      assert.ok(behind.length >= 1 && behind.every((p) => Math.abs(bearingOf(p)) >= 110), at("lurkers are behind the player: " + behind.map((p) => Math.round(bearingOf(p)))));
      assert.ok(doc.actors.length > behind.length, at("a bot in front keeps the player busy"));
      for (const d of doc.dispatchers || []) if (d.hear) assert.ok(d.hear.sources.includes("shot") || d.hear.sources.includes("footstep"), at("lurkers hear shots or steps"));
    }
    if (/off-angle-chain/.test(file)) {
      assert.ok(doc.actors.length >= 3, at("a chain of three or more"));
      assert.strictEqual(afterKills.length, doc.actors.length - 1, at("every bot but the first waits for a kill"));
      assert.strictEqual(new Set(afterKills.map((x) => x.afterKill[0])).size, afterKills.length, at("every bot after the first follows a different kill"));
    }
    if (/trade-swing-delays/.test(file)) {
      assert.ok(afterKills.length === 2 && afterKills[0].afterKill[0] === afterKills[1].afterKill[0], at("two partners trade the same kill"));
    }
    if (/shoulder-peek-read/.test(file)) {
      const shoulder = doc.actors.filter((a) => !gated.has(a.id));
      assert.strictEqual(shoulder.length, 1, at("one shoulder bot"));
      const cr = movement(shoulder[0]);
      assert.ok((cr.pauses || []).some((w) => w.at === 1 && w.wait > 0 && w.wait <= 0.4), at("the shoulder is out for 0.4 s or less"));
      assert.strictEqual(gated.size, 1, at("one sound-gated partner"));
    }
    if (/choke-entry/.test(file)) assert.ok(afterKills.length >= 1, at("a trading partner"));
    if (/retake-staggered/.test(file)) {
      const delays = [...doc.spawners.map((s) => (s.spawnDelay || [0])[0]), ...(doc.dispatchers || []).map((d) => (d.spawnDelay || [0])[0])];
      assert.ok(new Set(delays.map((d) => Math.round(d * 10))).size >= 3, at("arrivals are staggered: " + delays));
    }
    if (/repeek/.test(file)) assert.ok(doc.actors.some((a) => movement(a)), at("peekers"));
    if (item.mapId === "infinity") {
      // no floor data for Abyss: every bot stands exactly where an existing scenario already put a bot
      const sp = doc.spawners.map((s) => ({ x: s.position.x, y: s.position.y - 0.3, z: s.position.z })).concat((doc.dispatchers || []).flatMap((d) => d.routes.filter((r) => r.at).map((r) => r.at)));
      for (const p of sp) assert.ok(kit.points.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.2 && Math.abs(q.y - p.y) < 0.6), at("an Abyss bot at (" + p.x + ", " + p.z + ") is not a spot an existing scenario uses"));
    }
  }

  // ---- siblings: <stem>-easy and <stem>-hard come in pairs, and the build lists them
  const stems = new Set(files.filter((f) => /-(easy|hard)\.json$/.test(f)).map((f) => f.replace(/-(easy|hard)\.json$/, "")));
  for (const stem of stems) {
    assert.ok(files.includes(stem + "-easy.json") && files.includes(stem + "-hard.json"), stem + " has both an easy and a hard file");
    const easy = readJson(path.join(SCEN, stem + "-easy.json")), hard = readJson(path.join(SCEN, stem + "-hard.json"));
    assert.strictEqual(easy.item.mapId, hard.item.mapId, stem + ": same map");
    assert.deepStrictEqual(docOf(easy).playerSpawn, docOf(hard).playerSpawn, stem + ": same start");
    assert.ok(docOf(hard).rules.playerDeath === "endRound" && docOf(easy).rules.playerDeath === undefined, stem + ": hard ends the round when you die, easy does not");
    const rx = (doc) => Math.min(...doc.actors.map((a) => a.behaviors.find((b) => b.kind === "shooter").reaction[0]));
    assert.ok(rx(docOf(hard)) < rx(docOf(easy)), stem + ": hard bots react faster");
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vw-"));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-scenarios.mjs"), "--check"], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, "scripts/build-scenarios.mjs --check failed:\n" + r.stdout + r.stderr);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // ---- coverage of the situations
  assert.ok(stats.maps.size >= 11, "spread over at least 11 maps (incl. Pearl, Icebox, Abyss), got " + [...stats.maps]);
  for (const m of ["pitt", "port", "infinity"]) assert.ok(stats.maps.has(m), "map " + m + " is covered");
  for (const fam of ["shoulder-peek-read", "off-angle-chain", "trade-swing-delays", "lurk-from-behind", "choke-entry", "repeek", "retake-staggered"]) assert.ok(files.filter((x) => x.includes(fam)).length >= 2, "situation " + fam + " has scenarios");
  assert.ok(stats.swing >= 2 && stats.hear >= 2 && stats.trade >= 4 && stats.flash >= 6 && stats.sniper >= 3, "uses swing triggers, sound areas, trades, flashes and snipers: " + JSON.stringify({ ...stats, maps: undefined, types: undefined }));
  assert.ok(stats.types.has("flash") && stats.types.has("hold"));
  assert.ok(stats.easy >= 30 && stats.hard >= 30);
  console.log(`${files.length} Workshop scenarios on ${stats.maps.size} maps: ${stats.swing} swing triggers, ${stats.hear} sound areas, ${stats.trade} trades, ${stats.flash} flashes`);
}

main().then(() => console.log("all valorant scenario tests passed"), (err) => { console.error(err); process.exit(1); });
