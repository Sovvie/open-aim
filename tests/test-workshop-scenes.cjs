// Checks the Target Workshop drill set written by tools/make-workshop-scenes.mjs: the files in scenarios/ match what the generator makes now,
// every scene passes the same checks as the game's scene reader (D_iGclxB.js, "Not a valid scene file"), the tunables work with the game's Tune
// screen rules (Dc2Dm9E6.js), each drill lands in the lobby filter it is meant for (ChJ6FlD4.js), and the numbers are sane (sizes, distances, view).
//   node tests/test-workshop-scenes.cjs
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const SCENARIOS = path.join(ROOT, "scenarios");
const RAD = Math.PI / 180;

const isObj = (t) => typeof t === "object" && t !== null && !Array.isArray(t);
const isNum = (t) => typeof t === "number" && Number.isFinite(t);
const isVec = (t) => isObj(t) && isNum(t.x) && isNum(t.y) && isNum(t.z);
const isPair = (t) => Array.isArray(t) && t.length === 2 && t.every(isNum);
const optNum = (t) => t === undefined || isNum(t);
const BEHAVIORS = ["replay", "strafe", "sway", "jump", "path", "cross", "shooter", "respawn", "blink", "decay"];
const WEAPONS = ["vandal", "phantom", "operator", "sheriff", "guardian", "spectre", "odin"];

// The game's reader, as far as it applies to these scenes (D_iGclxB.js function cs), plus shape checks of the behaviours we use.
function validateScene(text, label) {
  const ok = (cond, msg) => assert(cond, `${label}: ${msg}`);
  const doc = JSON.parse(text);
  ok(isObj(doc) && doc.schemaVersion === 2, "schemaVersion 2");
  ok(isObj(doc.meta) && isNum(doc.meta.seed), "meta.seed");
  ok(isObj(doc.environment) && Array.isArray(doc.blocks) && Array.isArray(doc.spawners) && Array.isArray(doc.actors), "top-level parts");
  ok(isObj(doc.rules) && isNum(doc.rules.duration), "rules.duration");
  ok(isObj(doc.playerSpawn) && isVec(doc.playerSpawn.position) && isNum(doc.playerSpawn.yaw), "playerSpawn");
  ok(doc.rules.duration > 0 && doc.rules.duration <= 86400, "duration range");
  const env = doc.environment;
  ok(isNum(env.fogNear) && isNum(env.fogFar) && isNum(env.ambientIntensity) && isNum(env.keyLightIntensity), "environment numbers");
  ok(env.grid && isNum(env.grid.size) && env.grid.size > 0 && isNum(env.grid.divisions) && env.grid.divisions > 0 && isVec(env.grid.position), "grid");
  for (const b of doc.blocks) ok(isVec(b.position) && isVec(b.size) && b.size.x > 0 && b.size.y > 0 && b.size.z > 0 && isNum(b.rotationY), "block " + b.id);
  for (const list of [doc.blocks, doc.actors]) {
    const seen = new Set();
    for (const i of list) { ok(typeof i.id === "string" && i.id && !seen.has(i.id), "unique id " + i.id); seen.add(i.id); }
  }
  const spawnerIds = new Set();
  const templates = new Set(doc.actors.map((a) => a.id));
  for (const s of doc.spawners) {
    ok(typeof s.id === "string" && s.id && !spawnerIds.has(s.id) && !templates.has(s.id), "unique spawner id"); spawnerIds.add(s.id);
    ok(isVec(s.position) && isVec(s.size) && s.size.x >= 0 && s.size.y >= 0 && s.size.z >= 0, "spawner position/size");
    ok(isNum(s.maxAlive) && s.maxAlive >= 1 && Number.isInteger(s.maxAlive), "spawner maxAlive");
    ok(isPair(s.spawnDelay) && s.spawnDelay[0] >= 0 && s.spawnDelay[0] <= s.spawnDelay[1], "spawner spawnDelay");
    ok(["area", "grid", "slots"].includes(s.kind), "spawner kind " + s.kind);
    ok(optNum(s.slotCount) && optNum(s.columns) && optNum(s.rows) && (s.columns === undefined || s.columns >= 1) && (s.rows === undefined || s.rows >= 1), "grid counts");
    ok(optNum(s.minAngularGap) && optNum(s.minAngularGapFromPrevious) && !(s.minAngularGap < 0) && !(s.minAngularGapFromPrevious < 0), "angular gaps");
    ok(templates.has(s.actorTemplateId), "spawner template exists");
    if (s.kind === "grid") ok(s.columns >= 1 && s.rows >= 1 && s.maxAlive <= s.columns * s.rows, "grid has room for maxAlive");
    if (s.kind === "slots") ok(s.slotCount >= 1, "slots count");
  }
  for (const a of doc.actors) {
    ok(isObj(a.body) && isNum(a.body.headSize) && optNum(a.body.bodyWidth) && optNum(a.body.bodyHeight), "actor body");
    ok(a.body.shape === "sphere" && isNum(a.body.radius) && a.body.radius > 0, "round target");
    ok(a.hitSlow === undefined || a.hitSlow === true, "hitSlow");
    ok(Array.isArray(a.behaviors), "behaviors list");
    for (const b of a.behaviors) {
      ok(BEHAVIORS.includes(b.kind), "behavior kind " + b.kind);
      if (b.kind === "sway") ok(b.unit === undefined || b.unit === "hz", "sway unit");
      if (b.kind === "sway") ok(isNum(b.frequency) && b.frequency > 0 && isNum(b.amplitude.x) && isNum(b.amplitude.y), "sway");
      if (b.kind === "path") ok(Array.isArray(b.waypoints) && b.waypoints.length >= 2 && b.waypoints.every(isVec) && b.speed > 0, "path");
      if (b.kind === "strafe") ok(isPair(b.speed) && isPair(b.travel) && b.speed[0] > 0 && b.travel[0] > 0 && b.travel[0] <= b.travel[1], "strafe");
      if (b.kind === "strafe" && b.dwell) ok(isPair(b.dwell) && b.dwell[0] >= 0, "strafe dwell");
      if (b.kind === "strafe" && b.tap) ok(Array.isArray(b.tap) && b.tap.length === 3 && b.tap.every(isNum) && b.tap[0] > 0 && b.tap[0] <= 1 && b.tap[1] <= b.tap[2], "strafe tap");
      if (b.kind === "jump") ok(isPair(b.interval) && b.height > 0, "jump");
      if (b.kind === "blink") ok(isPair(b.visible) && isPair(b.hidden) && b.visible[0] > 0 && b.hidden[0] > 0, "blink");
      if (b.kind === "decay") ok(b.lifetime > 0 && b.growTime >= 0 && b.minScale > 0 && b.minScale <= 1, "decay");
      if (b.kind === "respawn") ok(isPair(b.delay) && ["never", "inPlace", "reSpawner"].includes(b.mode), "respawn");
    }
  }
  // Dispatchers (BiMsX6Xn.js, the game's reader Pt in D_iGclxB.js): routes are points that light up one after the other.
  const disp = doc.dispatchers === undefined ? [] : doc.dispatchers;
  ok(Array.isArray(disp), "dispatchers is a list");
  ok(doc.spawners.length > 0 || disp.length > 0, "something spawns the targets");
  const dispIds = new Set();
  for (const d of disp) {
    ok(typeof d.id === "string" && d.id && !dispIds.has(d.id) && !spawnerIds.has(d.id) && !templates.has(d.id), "unique dispatcher id"); dispIds.add(d.id);
    ok(typeof d.name === "string" && Array.isArray(d.routes) && d.routes.length >= 1, "dispatcher routes");
    for (const rt of d.routes) {
      ok(isObj(rt) && templates.has(rt.templateId), "route template exists");
      ok(isPair(rt.streak), "route streak");
      ok(rt.at === undefined || isVec(rt.at), "route at"); ok(optNum(rt.rotationY), "route rotationY");
      ok(rt.stay === undefined || (isPair(rt.stay) && rt.stay[0] > 0 && rt.stay[0] <= rt.stay[1]), "route stay");
      ok(rt.point === undefined || rt.point === true, "route point");
      if (rt.point === true) ok(isVec(rt.at), "a point needs a place");
    }
    ok(["random", "shuffle", "sequence"].includes(d.order), "dispatcher order");
    ok(isNum(d.maxAlive) && Number.isInteger(d.maxAlive) && d.maxAlive >= 1 && d.maxAlive <= 8, "dispatcher maxAlive");
    ok(isPair(d.interval) && d.interval[0] >= 0 && d.interval[0] <= d.interval[1], "dispatcher interval");
    ok(d.faceTarget === undefined || typeof d.faceTarget === "boolean", "dispatcher faceTarget");
    ok(optNum(d.total), "dispatcher total");
  }
  const r = doc.rules;
  ok(WEAPONS.includes(r.weapon), "weapon " + r.weapon);
  ok(["clicking", "tracking"].includes(r.scoring), "scoring");
  ok(r.fireMode === "single" || r.fireMode === "hold", "fireMode");
  ok(optNum(r.fireWindowSec) && typeof r.playerMovable === "boolean", "rules types");
  ok(r.perfectAccuracy === undefined || typeof r.perfectAccuracy === "boolean", "perfectAccuracy");
  if (r.expiredPenalty !== undefined) ok(Number.isInteger(r.expiredPenalty) && r.expiredPenalty >= 1 && r.expiredPenalty <= 5000, "expiredPenalty range");
  if (r.scoring === "tracking") ok(r.targetsInvincible === true, "tracking needs invincible targets");
  return doc;
}

// The Tune screen's rules (Dc2Dm9E6.js Mh / Eh): which fields exist, on which node, and that today's value sits inside min..max.
const TUNABLE_NODE = { radius: "template", maxAlive: "spawner", spacing: "spawner", spacingX: "spawner", width: "spawner", height: "spawner", duration: "rules",
  "decay.lifetime": "template", "jump.height": "template", "strafe.speed": "template", "dispatcher.stay": "dispatcher", "dispatcher.maxAlive": "dispatcher" };
const INTEGER_FIELDS = new Set(["maxAlive", "duration"]);
function tunableValue(doc, t) {
  const sp = doc.spawners.find((s) => s.id === t.id), tpl = doc.actors.find((a) => a.id === t.id), dp = (doc.dispatchers || []).find((d) => d.id === t.id);
  switch (t.field) {
    case "radius": return tpl.body.radius;
    case "maxAlive": return sp.maxAlive;
    case "duration": return doc.rules.duration;
    case "spacing": { const x = sp.size.x / (sp.columns - 1), y = sp.size.y / (sp.rows - 1); assert(Math.abs(x - y) < 1e-6, "spacing needs equal x and y steps"); return x; }
    case "spacingX": assert(sp.kind === "grid" && sp.columns > 1); return sp.size.x / (sp.columns - 1);
    case "width": assert(sp.kind === "area"); return sp.size.x;
    case "decay.lifetime": return tpl.behaviors.find((b) => b.kind === "decay").lifetime;
    case "jump.height": return tpl.behaviors.find((b) => b.kind === "jump").height;
    case "strafe.speed": { const b = tpl.behaviors.find((x) => x.kind === "strafe"); assert(Math.abs(b.speed[0] - b.speed[1]) < 1e-9, "strafe speed must be one number to be adjustable"); return b.speed[0]; }
    case "dispatcher.maxAlive": return dp.maxAlive;
    case "dispatcher.stay": {
      const stays = dp.routes.filter((r) => r.point === true).map((r) => r.stay);
      assert(stays.length && stays.every((p) => p && p[0] === p[1] && p[0] === stays[0][0]), "every point needs the same fixed stay time to be adjustable");
      return stays[0][0];
    }
    default: throw new Error("unknown tunable " + t.field);
  }
}

// The lobby's drill reader (ChJ6FlD4.js IP): which filter chip a scene lands under.
function lobbySkill(doc) {
  const actors = new Map(doc.actors.map((a) => [a.id, a]));
  const sp = [...doc.spawners].sort((a, b) => b.maxAlive - a.maxAlive)[0];
  const points = (doc.dispatchers || []).flatMap((d) => d.routes).filter((rt) => rt.point === true && rt.at).length;
  const tpl = sp ? actors.get(sp.actorTemplateId) : actors.get(doc.dispatchers[0].routes[0].templateId);
  const kinds = new Set(tpl.behaviors.map((b) => b.kind));
  const form = points >= 2 && !sp ? "points" : kinds.has("strafe") ? "strafe" : kinds.has("sway") || kinds.has("path") ? "sway" : kinds.has("blink") ? "blink" : sp.kind === "grid" ? "grid" : "area";
  if (doc.rules.scoring === "tracking") return "Tracking";
  return form === "blink" || form === "points" ? "Reaction" : form === "strafe" || form === "sway" ? "Moving" : "Flicking";
}

const diaOf = (r, d) => (2 * Math.atan(r / d)) / RAD; // ball width in degrees of view
const distOf = (z) => 4.2 - z;

async function main() {
  const gen = await import(pathToFileURL(path.join(ROOT, "tools", "make-workshop-scenes.mjs")).href);
  const scenes = gen.allScenes();
  assert(scenes.length >= 40 && scenes.length % 2 === 0, "expected easy/hard pairs, got " + scenes.length);

  // deterministic: building twice gives identical documents
  const sig = (list) => JSON.stringify(list.map((s) => [s.file, s.name, s.description, s.sort, s.doc]));
  assert.strictEqual(sig(gen.allScenes()), sig(scenes), "generator is not deterministic");

  const onDisk = new Map();
  for (const f of fs.readdirSync(SCENARIOS).filter((x) => x.endsWith(".json"))) {
    onDisk.set(f.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(SCENARIOS, f), "utf-8").replace(/^﻿/, "")));
  }
  const mine = new Set(scenes.map((s) => s.file));
  const others = [...onDisk.entries()].filter(([f]) => !mine.has(f)).map(([, d]) => d.item);
  const names = new Set(others.map((i) => i.name)), codes = new Set(others.map((i) => i.shareCode)), sorts = new Set(others.map((i) => i.sort));

  const mySorts = new Set(), myNames = new Set(), myCodes = new Set(), stems = new Map();
  for (const s of scenes) {
    const label = s.file;
    const data = onDisk.get(s.file);
    assert(data, `${label}: missing file, run node tools/make-workshop-scenes.mjs`);
    const { item, scene } = data;
    const docText = JSON.stringify(s.doc);
    assert.strictEqual(typeof scene.doc === "string" ? scene.doc : JSON.stringify(scene.doc), docText, `${label}: file differs from the generator (run it again)`);
    assert.strictEqual(item.name, s.name); assert.strictEqual(item.description, s.description);
    assert.strictEqual(item.docBytes, Buffer.byteLength(docText, "utf-8"), label + " docBytes");

    // item / scene fields (scripts/build-scenarios.mjs)
    assert.strictEqual(item.type, "ball", label + " type ball"); assert.strictEqual(item.mapId, null);
    assert(/^[0-9a-f]{16}$/.test(item.shareCode), label + " shareCode shape");
    assert.strictEqual(item.shareCode, crypto.createHash("sha1").update("aimlocal-set:" + s.name).digest("hex").slice(0, 16), label + " shareCode derives from the name");
    assert.strictEqual(item.sceneKey, "set-" + item.shareCode); assert.strictEqual(scene.shareCode, item.shareCode);
    assert(!names.has(item.name) && !myNames.has(item.name), label + " name is unique"); myNames.add(item.name);
    assert(!codes.has(item.shareCode) && !myCodes.has(item.shareCode), label + " shareCode is unique"); myCodes.add(item.shareCode);
    assert(item.sort >= 205 && item.sort <= 299 && !sorts.has(item.sort) && !mySorts.has(item.sort), label + " sort " + item.sort); mySorts.add(item.sort);
    assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.file) && /-(easy|hard)$/.test(s.file), label + " file name");
    assert(item.name.trim() && item.description.length >= 80 && item.description.length <= 420, label + " description length " + item.description.length);

    const doc = validateScene(docText, label);
    assert.strictEqual(scene.blockCount, doc.blocks.length);
    assert.strictEqual(lobbySkill(doc), s.skill, `${label}: lobby would file it under ${lobbySkill(doc)}, wanted ${s.skill}`);

    // tunables
    const seen = new Set();
    for (const t of doc.rules.tunables) {
      assert(TUNABLE_NODE[t.field], `${label}: tunable ${t.field} unknown to the game`);
      const key = t.field + "@" + (t.id ?? ""); assert(!seen.has(key), `${label}: duplicate tunable ${key}`); seen.add(key);
      if (TUNABLE_NODE[t.field] === "rules") assert.strictEqual(t.id, undefined);
      else assert(typeof t.id === "string" && (TUNABLE_NODE[t.field] === "template" ? doc.actors : TUNABLE_NODE[t.field] === "dispatcher" ? doc.dispatchers || [] : doc.spawners).some((n) => n.id === t.id), `${label}: tunable ${key} points nowhere`);
      assert(typeof t.label === "string" && t.label.trim() && isNum(t.min) && isNum(t.max) && t.step > 0 && t.min < t.max && t.min > 0, `${label}: tunable ${key} shape`);
      if (INTEGER_FIELDS.has(t.field)) assert(Number.isInteger(t.min) && Number.isInteger(t.max) && Number.isInteger(t.step), `${label}: ${key} whole numbers`);
      const v = tunableValue(doc, t);
      assert(v >= t.min - 1e-9 && v <= t.max + 1e-9, `${label}: ${key} value ${v} outside ${t.min}..${t.max}`);
    }

    // numbers a player would notice
    const actor = doc.actors[0], sp = doc.spawners[0] || null, r = actor.body.radius, built = s.built;
    const dia = diaOf(r, built.dist);
    assert(dia >= 0.7 && dia <= 8, `${label}: ball is ${dia.toFixed(2)} degrees wide`);
    assert(Math.abs(dia - built.dia) < 0.05, `${label}: ball width ${dia} vs ${built.dia}`);
    if (doc.dispatchers) {
      // points that light up in turn: every point is in a comfortable place, none touch each other
      assert.strictEqual(doc.spawners.length, 0, label + " dispatcher drills have no spawner");
      const pts = doc.dispatchers.flatMap((d) => d.routes.map((rt) => rt.at));
      assert(pts.length >= 2, label + " needs at least two points");
      for (const p of pts) {
        const dist = distOf(p.z);
        assert(dist >= 8, label + " point only " + dist + " m away");
        assert(Math.atan((Math.abs(p.x) + r) / dist) / RAD <= 44, label + " point too near the edge of the view");
        assert(p.y - r >= 0.3 && p.y + r <= 6.6, label + " point height");
        assert(Math.atan((p.y + r - 1.75) / dist) / RAD <= 24, label + " point too far above the crosshair");
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) > 2 * r, label + " two points overlap");
      for (const d of doc.dispatchers) assert(d.maxAlive <= d.routes.length, label + " more lit than points");
    } else if (doc.rules.scoring === "clicking") {
      const dist = distOf(sp.position.z);
      assert(dist >= 8, `${label}: wall only ${dist} m away`);
      assert(Math.abs(sp.position.x) < 1e-9 || ["bounce", "bounce-wall"].includes(s.stem), label + " wall is centred");
      const edge = Math.atan((sp.size.x / 2 + r) / dist) / RAD;
      assert(edge <= 44, `${label}: outermost target is ${edge.toFixed(1)} degrees off the centre, too near the edge of the view`);
      const sway = actor.behaviors.find((b) => b.kind === "sway"), swayY = sway ? sway.amplitude.y : 0;
      assert(sp.position.y - sp.size.y / 2 - r - swayY >= 0.3, `${label}: ball would touch the floor`);
      assert(sp.position.y + sp.size.y / 2 + r + swayY <= 6.6, `${label}: ball too high`);
      assert(Math.atan((sp.position.y + sp.size.y / 2 + r - 1.75) / dist) / RAD <= 24, `${label}: top row too far above the crosshair`);
      if (sp.kind === "grid" && sp.columns > 1) assert(sp.size.x / (sp.columns - 1) > 2 * r, `${label}: grid balls overlap`);
      if (sp.kind === "grid" && sp.rows > 1) assert(sp.size.y / (sp.rows - 1) > 2 * r, `${label}: grid rows overlap`);
      if (sp.kind === "slots") assert(sp.size.x / (sp.slotCount - 1) > 2 * r, `${label}: slots overlap`);
    } else {
      // tracking: every waypoint stays 6 m or more from the player, inside a comfortable view, above the floor
      const pathB = actor.behaviors.find((b) => b.kind === "path"), way = pathB ? pathB.waypoints : [];
      for (const w of way) {
        const d = Math.hypot(w.x, distOf(w.z));
        assert(d >= 6 && d <= 40, `${label}: waypoint ${d.toFixed(1)} m away`);
        assert(Math.abs(Math.atan(w.x / distOf(w.z))) / RAD <= 40, label + " waypoint too far to the side");
        assert(w.y - r >= 0.2 && w.y + r <= 6.6, label + " waypoint height");
      }
      if (pathB) {
        assert.deepStrictEqual(sp.position, way[0], label + " starts on its path");
        const last = way[way.length - 1], first = way[0];
        assert(Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z) < 0.02, label + " loop closes");
      } else {
        // a swaying or strafing tracking target: it stays inside a comfortable view the whole time and above the floor
        const sway = actor.behaviors.find((b) => b.kind === "sway"), strafe = actor.behaviors.find((b) => b.kind === "strafe");
        assert(sway || strafe, label + " tracking drill needs a path, sway or strafe");
        const dist = distOf(sp.position.z), ax = sway ? sway.amplitude.x : strafe.travel[1] * 2, ay = sway ? sway.amplitude.y : 0;
        assert(dist >= 6 && Math.atan((ax + r) / dist) / RAD <= 40, label + " tracking target swings too far to the side");
        assert(sp.position.y - ay - r >= 0.2 && sp.position.y + ay + r <= 6.6, label + " tracking height");
        assert(sp.size.x === 0 && sp.size.y === 0, label + " a tracking target starts in one place");
      }
    }
    (stems.get(s.stem) || stems.set(s.stem, {}).get(s.stem))[s.tier] = { s, doc };
  }

  // pairs: the hard one differs and has the smaller (or equal) balls; they sit side by side in the list
  for (const [name, t] of stems) {
    assert(t.easy && t.hard, name + " needs both tiers");
    const body = (x) => JSON.stringify({ a: x.doc.actors, s: x.doc.spawners, d: x.doc.dispatchers, r: x.doc.rules });
    assert.notStrictEqual(body(t.easy), body(t.hard), name + ": easy and hard are the same");
    assert.strictEqual(t.easy.s.sort + 1, t.hard.s.sort, name + " pair sits side by side");
    assert(diaOf(t.hard.doc.actors[0].body.radius, t.hard.s.built.dist) <= diaOf(t.easy.doc.actors[0].body.radius, t.easy.s.built.dist) + 1e-6, name + ": hard balls are bigger than easy ones");
  }
  const skills = new Set(scenes.map((s) => s.skill));
  for (const k of ["Flicking", "Reaction", "Moving", "Tracking"]) assert(skills.has(k), "no " + k + " drill");

  // ---- round 2 ---------------------------------------------------------------------------------------------------------------------
  // the first 44 files (round 1) keep their sort order 205-248; the new drills sort 249 and up, in pairs
  const round1 = scenes.filter((x) => x.sort <= 248), round2 = scenes.filter((x) => x.sort >= 249);
  assert.strictEqual(round1.length, 44, "round 1 is 22 pairs");
  assert(round2.length >= 20 && round2.length % 2 === 0, "round 2 has easy/hard pairs");
  for (const x of round2) assert(x.sort >= 249 && x.sort <= 299, x.file + " sort in the round 2 range");
  assert(round2.some((x) => x.doc.dispatchers), "a dispatcher drill exists");
  assert(round2.some((x) => x.skill === "Tracking" && x.doc.actors[0].behaviors.some((b) => b.kind === "sway")), "a swaying tracking drill exists");
  assert(round2.some((x) => x.skill === "Tracking" && x.doc.actors[0].behaviors.some((b) => b.kind === "strafe")), "a strafing tracking drill exists");
  assert(round2.some((x) => x.doc.rules.playerMovable === true && x.doc.rules.perfectAccuracy === false), "a counter-strafe trainer lets you move with real inaccuracy");
  const sprayHealth = new Set(round2.filter((x) => x.stem.startsWith("spray-")).map((x) => x.doc.rules.weapon + ":" + x.doc.actors[0].health));
  assert(sprayHealth.size >= 4 && [...sprayHealth].some((k) => k.startsWith("vandal:")) && [...sprayHealth].some((k) => k.startsWith("phantom:")), "spray drills for both rifles with different health");

  // ---- tracking drills are scored by time on target and never need the fire button ------------------------------------------------------
  // (tools/patch-tracking-no-fire.cjs: the game counts a frame whenever the aim ray is on the target; shots, ammo and a button play no part)
  let trackingFiles = 0;
  for (const [file, data] of onDisk) {
    const doc = typeof data.scene.doc === "string" ? JSON.parse(data.scene.doc) : data.scene.doc;
    if (doc.rules.scoring !== "tracking") continue;
    trackingFiles++;
    assert.strictEqual(doc.rules.targetsInvincible, true, file + ": a tracking drill needs invincible targets");
    assert(!doc.rules.limitedAmmo, file + ": a tracking drill must not run out of ammo");
    assert(!doc.actors.some((a) => a.behaviors.some((b) => b.kind === "shooter")), file + ": a tracking target does not shoot");
    assert(doc.actors.every((a) => a.hitSlow === true), file + ": tracking targets are slowed by a hit like the other tracking drills");
    assert(!doc.actors.some((a) => a.behaviors.some((b) => b.kind === "respawn")), file + ": a tracking target is never killed, so it has no respawn");
    assert.strictEqual(data.item.type, "ball", file + ": lists under the Target Workshop");
  }
  assert(trackingFiles >= 9, "tracking drills found: " + trackingFiles);
  for (const dir of ["next/js", "_assets/r20261021-1/next/js"]) {
    const eng = fs.readFileSync(path.join(ROOT, "app", "site", dir, "OkAdunfX.js"), "utf-8");
    assert(eng.includes("/*aim-trackcover*/"), dir + ": the tracking-without-fire patch is in the game files (run tools/patch-tracking-no-fire.cjs)");
    assert(!eng.includes("!o||!y.fire)return;l.frames++"), dir + ": a frame still needs the fire button to count");
  }

  // ---- every Target Workshop drill (workshop-*, tracking-*) draws a sensible thumbnail in the Routines picker ---------------------------------------
  const SRC = fs.readFileSync(path.join(ROOT, "app", "routines.js"), "utf-8");
  const store = new Map(), ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const win = { localStorage: ls, dispatchEvent() {}, addEventListener() {} };
  new Function("window", "localStorage", "fetch", SRC)(win, ls, async () => ({ json: async () => ({}) }));
  const R = win.__aimRoutines;
  let thumbs = 0;
  for (const [file, data] of onDisk) {
    if (data.item.type !== "ball") continue;
    const doc = typeof data.scene.doc === "string" ? JSON.parse(data.scene.doc) : data.scene.doc;
    const W = 1600, H = 900, m = R.ui.thumbModel(doc, W, H);
    thumbs++;
    const live = m.balls.filter((b) => b.live);
    assert(live.length >= 1, file + ": thumbnail has no lit ball");
    for (const b of m.balls) assert([b.x, b.y, b.r].every(Number.isFinite) && b.r > 0, file + ": thumbnail ball is not a number");
    assert(live.some((b) => b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H), file + ": no lit ball is inside the picture");
    const biggest = Math.max(...live.map((b) => b.r)), smallest = Math.min(...live.map((b) => b.r));
    assert(biggest >= 3 && smallest <= 200, file + ": thumbnail ball size " + smallest + ".." + biggest);
    const d0 = doc.dispatchers && doc.dispatchers[0];
    if (d0) {
      assert.strictEqual(m.balls.length, d0.routes.length, file + ": every point is drawn");
      assert.strictEqual(live.length, Math.min(d0.maxAlive, d0.routes.length), file + ": as many lit as the dispatcher lights at once");
    }
    if (doc.actors[0].behaviors.some((b) => b.kind === "path")) assert(m.lines.length >= 1, file + ": a path drill draws its path");
    if (doc.actors[0].behaviors.some((b) => b.kind === "strafe")) assert(m.arrows.length >= 1, file + ": a strafe drill draws its arrow");
  }
  assert(thumbs >= 54, "thumbnail check ran on " + thumbs + " Target Workshop drills");

  // ---- medals work for these scoring types: points (clicking and tracking) are higher-is-better, a result in seconds would flip ---------------
  // (the game's result screen prints the score with the unit "pts" for every ball drill, see app/routines.js readResult)
  const L = R.logic;
  assert.strictEqual(L.lowerBetter("pts"), false); assert.strictEqual(L.lowerBetter("%"), false); assert.strictEqual(L.lowerBetter("s"), true);
  for (const [label, scores] of [["clicking", [4200, 4600, 4400, 4800, 4300, 5000]], ["tracking", [38, 55, 47, 61, 52, 70]]]) {
    const state = {}, code = "a".repeat(16);
    const out = scores.map((sc) => L.recordRun(state, { code, name: label, unit: "pts", score: sc, end: "time", at: 1 }));
    assert.strictEqual(out[0].medal, null, label + ": no medal on the first run");
    assert(out[1].thresholds === null || out[2].thresholds === null, label + ": no thresholds before " + L.MIN_RUNS + " runs");
    const th = L.thresholds(state[code]);
    assert(th && th.bronze <= th.silver && th.silver <= th.gold, label + " medal thresholds are ordered");
    assert.strictEqual(L.medalFor(th.gold + 1, th, state[code].lower), "gold"); assert.strictEqual(L.medalFor(th.bronze - 1, th, state[code].lower), null);
    assert.strictEqual(out[out.length - 1].medal === null || L.MEDALS.includes(out[out.length - 1].medal), true);
  }
  // a drill with a hand-set medal table: the three numbers are used as they are
  { const state = {}, code = "b".repeat(16); L.recordRun(state, { code, name: "t", unit: "pts", score: 50, end: "time", at: 1 }); state[code].custom = { bronze: 40, silver: 60, gold: 80 };
    assert.strictEqual(L.medalFor(61, L.thresholds(state[code]), state[code].lower), "silver"); }

  console.log(`ok: ${scenes.length} scenes, ${stems.size} drills, skills ${[...skills].join("/")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
