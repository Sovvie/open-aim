// Writes the Target Workshop tracking scenes into scenarios/ (18 Nov 2026).
//   node tools/make-tracking-scenes.mjs        then:  node scripts/build-scenarios.mjs
// Each scene is one round ball that moves while you keep the crosshair on it ("tracking" scoring: time on target scores). The scenes copy the
// pattern of the game's own tracking scene ("Mouse recentering practice"): a sphere actor with a path or strafe behaviour, hold-to-fire,
// invincible target, perfect accuracy, the player standing still. item.type "ball" puts them in the Target Workshop tab.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scenarios");
const NOW = "2026-11-18 12:00:00";
const codeOf = (name) => crypto.createHash("sha1").update("aimlocal-set:" + name).digest("hex").slice(0, 16);

// x = across, y = height above the floor (the player's eye is 1.75), z = depth (the player stands at z 4.2 looking along -z).
const P = (x, y, z) => ({ x, y, z });
const SCENES = [
  {
    file: "tracking-slow-sweep", name: "Tracking — Slow sweep", sort: 200,
    description: "One big ball glides left and right at a walking pace. Stay on it for the whole 60 seconds: your time on target is your score.",
    radius: 0.5, spawn: P(0, 1.6, -14),
    behaviors: [{ kind: "path", waypoints: [P(-7, 1.6, -14), P(7, 1.6, -14), P(-7.01, 1.6, -14)], loop: true, speed: 3.2 }],
  },
  {
    file: "tracking-fast-sweep", name: "Tracking — Fast sweep", sort: 201,
    description: "A medium ball sweeps across your view at sprint speed. Match its speed instead of chasing it.",
    radius: 0.4, spawn: P(0, 1.6, -14),
    behaviors: [{ kind: "path", waypoints: [P(-8, 1.6, -14), P(8, 1.6, -14), P(-8.01, 1.6, -14)], loop: true, speed: 8.5 }],
  },
  {
    file: "tracking-diagonals", name: "Tracking — Diagonals", sort: 202,
    description: "The ball zig-zags up and down as it crosses, so you track both left-right and up-down at once.",
    radius: 0.42, spawn: P(0, 2.6, -15),
    behaviors: [{ kind: "path", waypoints: [P(-6, 0.9, -15), P(6, 3.6, -15), P(-6, 3.6, -15), P(6, 0.9, -15), P(-6.01, 0.9, -15)], loop: true, speed: 5.2 }],
  },
  {
    file: "tracking-strafe-reversals", name: "Tracking — Strafe reversals", sort: 203,
    description: "The ball runs, stops and changes direction at random, like a player strafing. Train staying on it through the reversals.",
    radius: 0.42, spawn: P(0, 1.7, -15), area: { x: 11, y: 0.1, z: 1 },
    behaviors: [{ kind: "strafe", speed: [3, 7], dwell: [0.06, 0.35], travel: [1, 3.5], counterStrafe: true }],
  },
  {
    file: "tracking-small-and-far", name: "Tracking — Small and far", sort: 204,
    description: "A small ball far away, moving at a steady pace. Tiny mouse movements only: this trains a steady hand.",
    radius: 0.25, spawn: P(0, 1.6, -26),
    behaviors: [{ kind: "path", waypoints: [P(-9, 1.6, -26), P(9, 2.4, -26), P(-9.01, 1.6, -26)], loop: true, speed: 4.2 }],
  },
];

function docOf(s) {
  return {
    schemaVersion: 2,
    meta: { id: "scene-" + parseInt(codeOf(s.name).slice(0, 7), 16), name: s.name, seed: parseInt(codeOf(s.name).slice(0, 7), 16), createdAt: 0 },
    environment: { skyColor: "#000000", fogNear: 15, fogFar: 40, ambientIntensity: 1.55, keyLightIntensity: 2.2,
      grid: { size: 42, divisions: 28, centerColor: "#ffffff", gridColor: "#0091ff", position: P(0, -0.02, 4.2) } },
    blocks: [{ id: "ground", shape: "plane", position: P(-0.2, -13.6, -8.8), rotationY: 0, size: { x: 40, y: 0.4, z: 45 }, color: "#18222b", collidable: true, transparent: true }],
    playerSpawn: { position: P(0, 0, 4.2), yaw: 0 },
    spawners: [{ id: "spawner-1", kind: "area", actorTemplateId: "actor-1", position: s.spawn, size: s.area || { x: 0.1, y: 0.1, z: 1 }, maxAlive: 1, spawnDelay: [0.2, 0.5] }],
    actors: [{ id: "actor-1", name: "Target", body: { shape: "sphere", headSize: 1, bodyWidth: 0.44, bodyHeight: 0, radius: s.radius }, color: "#ff4655", behaviors: s.behaviors, hitSlow: true }],
    rules: {
      duration: 60, scoring: "tracking", weapon: "vandal", playerMovable: false, fireMode: "hold", targetsInvincible: true, perfectAccuracy: true,
      tunables: [
        { field: "radius", id: "actor-1", label: "Target size", min: 0.1, max: 0.8, step: 0.01 },
        { field: "duration", label: "Round length", min: 30, max: 180, step: 15 },
      ],
    },
  };
}

fs.mkdirSync(OUT, { recursive: true });
for (const s of SCENES) {
  const shareCode = codeOf(s.name), doc = docOf(s), docText = JSON.stringify(doc), docBytes = Buffer.byteLength(docText, "utf-8");
  const common = { name: s.name, description: s.description, shareCode, sceneKey: "set-" + shareCode, createTime: NOW, updateTime: NOW, docBytes, playCount: 0, status: 1, featured: false, parSeconds: null };
  const data = {
    item: { ...common, mapId: null, sort: s.sort, type: "ball" },
    scene: { ...common, schemaVersion: 2, blockCount: 1, authorNickname: "openVaim", authorUid: "openvaim", sceneHash: crypto.createHash("sha1").update(docText).digest("hex").slice(0, 16), doc },
  };
  fs.writeFileSync(path.join(OUT, s.file + ".json"), JSON.stringify(data, null, 2) + "\n");
  console.log("wrote scenarios/" + s.file + ".json  " + shareCode);
}
