// Test for the Valorant Workshop scenarios (tools/make-valorant-scenes.mjs and scenarios/workshop-*.json). Run: node test-valorant-scenes.cjs
// Checks every generated scenario as far as the game's own checks can be reproduced:
//  - the committed files are exactly what the generator makes (it is deterministic)
//  - item / scene fields, unique names and share codes (also against every other scenario), sort 300-399, sibling pairs
//  - the game's own scene validator (app/site/next/js/D_iGclxB.js, the "Not a valid scene file" check) accepts each doc
//  - positions are finite numbers and stand on the map's walkable floor (app/studio/map-data.js, the Studio's own floor data)
//  - spawners and dispatcher routes name actor templates that exist, behaviours are known, trigger fields point at real actors
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
  assert.deepStrictEqual(files, built.map((b) => b.file).sort(), "scenarios/workshop-*.json differ from the generator's list: run node tools/make-valorant-scenes.mjs");
  for (const b of built) {
    const onDisk = readJson(path.join(SCEN, b.file));
    assert.deepStrictEqual(onDisk, JSON.parse(JSON.stringify(b.data)), b.file + " is out of date: run node tools/make-valorant-scenes.mjs");
  }
  assert.ok(files.length >= 25, "expected about 25 or more Workshop scenarios, got " + files.length);

  // ---- every other scenario, to catch name / code collisions
  const others = fs.readdirSync(SCEN).filter((f) => f.endsWith(".json") && !files.includes(f)).map((f) => readJson(path.join(SCEN, f)).item);
  const names = new Set(others.map((i) => i.name)), codes = new Set(others.map((i) => i.shareCode));
  const kits = {};
  const stats = { maps: new Set(), swing: 0, hear: 0, trade: 0, flash: 0, sniper: 0, types: new Set(), easy: 0, hard: 0 };

  for (const file of files) {
    const data = readJson(path.join(SCEN, file)), { item, scene } = data, doc = docOf(data);
    const at = (msg) => file + ": " + msg;
    assert.ok(/^workshop-[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(file), at("file name"));
    // item and scene fields (the same rules as scripts/build-scenarios.mjs)
    for (const key of ["name", "description"]) assert.ok(typeof item[key] === "string" && item[key].trim(), at("item." + key));
    assert.ok(item.description.length <= 400, at("description is short enough for the lobby card"));
    assert.ok(/^[0-9a-f]{16}$/.test(item.shareCode), at("shareCode"));
    assert.strictEqual(item.shareCode, gen.shareCodeOf(item.name), at("shareCode is the documented sha1 of the name"));
    assert.strictEqual(item.sceneKey, "set-" + item.shareCode, at("sceneKey"));
    assert.strictEqual(scene.shareCode, item.shareCode, at("scene.shareCode"));
    assert.strictEqual(scene.name, item.name, at("scene.name"));
    assert.ok(item.sort >= 300 && item.sort <= 399, at("sort in 300-399"));
    assert.ok(["hold", "flash"].includes(item.type), at("type is hold or flash, got " + item.type));
    assert.ok(typeof item.mapId === "string" && kitMod.MAPS_WITH_DATA.includes(item.mapId), at("map " + item.mapId + " has floor data"));
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
    const kit = kits[item.mapId] || (kits[item.mapId] = await kitMod.loadMapKit(item.mapId));
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
        if (r.at) stand(r.at, "dispatcher " + d.id);
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
  assert.ok(stats.maps.size >= 6, "spread over at least 6 maps, got " + [...stats.maps]);
  assert.ok(stats.swing >= 2 && stats.hear >= 2 && stats.trade >= 4 && stats.flash >= 6 && stats.sniper >= 3, "uses swing triggers, sound areas, trades, flashes and snipers: " + JSON.stringify({ ...stats, maps: undefined, types: undefined }));
  assert.ok(stats.types.has("flash") && stats.types.has("hold"));
  assert.ok(stats.easy >= 10 && stats.hard >= 10);
  console.log(`${files.length} Workshop scenarios on ${stats.maps.size} maps: ${stats.swing} swing triggers, ${stats.hear} sound areas, ${stats.trade} trades, ${stats.flash} flashes`);
}

main().then(() => console.log("all valorant scenario tests passed"), (err) => { console.error(err); process.exit(1); });
