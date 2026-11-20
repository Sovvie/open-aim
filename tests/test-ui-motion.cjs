// ui-motion: page-watch no-op filter, focus-ring decision, and the theme's motion/a11y block.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const APP = path.join(__dirname, "..", "app");
let checks = 0;

// ---------- page-watch.js: batches of same-text swaps do not wake watchers ----------
{
  const observers = [];
  class FakeObserver {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {} disconnect() {}
  }
  const listeners = {};
  const window = {};
  const document = { documentElement: {}, pointerLockElement: null, addEventListener: (t, f) => { listeners[t] = f; } };
  vm.runInNewContext(fs.readFileSync(path.join(APP, "page-watch.js"), "utf8"), { window, document, MutationObserver: FakeObserver });
  const calls = [];
  window.__aimWatchPage((records) => calls.push(records), { childList: true, subtree: true });
  const text = (data) => ({ nodeType: 3, data });
  const swap = (a, b) => ({ type: "childList", addedNodes: [text(b)], removedNodes: [text(a)] });
  const obs = observers[0];
  obs.cb([swap("Same label", "Same label")], obs);
  assert.strictEqual(calls.length, 0, "a same-text swap must not wake the watcher"); checks++;
  obs.cb([swap("Same", "Same"), swap("x", "x")], obs);
  assert.strictEqual(calls.length, 0, "a batch of only same-text swaps is skipped"); checks++;
  obs.cb([swap("Old", "New")], obs);
  assert.strictEqual(calls.length, 1, "a real text change still wakes it"); checks++;
  obs.cb([swap("Same", "Same"), { type: "childList", addedNodes: [{ nodeType: 1 }], removedNodes: [] }], obs);
  assert.strictEqual(calls.length, 2, "a batch with one real change wakes it"); checks++;
  // unlock catch-up passes no records and must still run
  document.pointerLockElement = null;
  listeners.pointerlockchange();
  assert.strictEqual(calls.length, 3, "the unlock catch-up call still runs"); checks++;
  assert.strictEqual(window.__aimWatchPageNoOp([]), false); checks++;
}

// ---------- interface-mode.js: when the focus ring has to go inside ----------
{
  const window = {};
  const docListeners = {};
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (t, f) => { docListeners[t] = f; },
  };
  window.__aimWatchPage = () => {};
  const localStorage = { getItem: () => null, setItem: () => {} };
  vm.runInNewContext(fs.readFileSync(path.join(APP, "interface-mode.js"), "utf8"), { window, document, localStorage, requestAnimationFrame: () => {}, Element: class {}, getComputedStyle: () => ({}) });
  const { needsInsetRing } = window.__aimFocusRing;
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
  assert.strictEqual(needsInsetRing(true, rect(10, 10, 50, 30), []), true, "own clip-path: inside"); checks++;
  assert.strictEqual(needsInsetRing(false, rect(10, 10, 50, 30), []), false, "nothing clips: outside"); checks++;
  assert.strictEqual(needsInsetRing(false, rect(10, 10, 50, 30), [rect(0, 0, 100, 100)]), false, "roomy parent: outside"); checks++;
  assert.strictEqual(needsInsetRing(false, rect(10, 10, 50, 30), [rect(8, 0, 100, 100)]), true, "parent edge 2 px away: inside"); checks++;
  assert.strictEqual(needsInsetRing(false, rect(10, 10, 50, 30), [rect(0, 0, 100, 32)]), true, "bottom edge too close: inside"); checks++;
  assert.ok(typeof docListeners.focusin === "function", "focusin listener installed"); checks++;
}

// ---------- theme-esports.css: tokens, reduced motion, focus and keyframes ----------
{
  const css = fs.readFileSync(path.join(APP, "theme-esports.css"), "utf8");
  for (const token of ["--es-dur-xs", "--es-dur-sm", "--es-dur-md", "--es-dur-lg", "--es-ease-out"]) {
    assert.ok(new RegExp(token + "\\s*:").test(css), token + " defined"); checks++;
  }
  const rm = css.indexOf("ui-motion: reduced motion");
  assert.ok(rm > 0, "reduced-motion block present"); checks++;
  const rmBlock = css.slice(rm, css.indexOf("ui-motion: Performance interface"));
  assert.ok(/prefers-reduced-motion: reduce/.test(rmBlock) && /animation-iteration-count: 1 !important/.test(rmBlock), "reduced motion stops loops"); checks++;
  assert.ok(/:not\(#es\):not\(#es-rm\)/.test(rmBlock), "reduced motion outranks the theme's !important animations"); checks++;
  // every animation name used in our CSS has a matching @keyframes (in our CSS or ui.css)
  const all = css + fs.readFileSync(path.join(APP, "ui.css"), "utf8") + fs.readFileSync(path.join(APP, "release-updates.css"), "utf8");
  const defined = new Set([...all.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  const used = new Set();
  for (const m of all.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+/).find((w) => /^(es|aim)-[\w-]+$/.test(w));
      if (name) used.add(name);
    }
  }
  for (const name of used) { assert.ok(defined.has(name), "missing @keyframes " + name); checks++; }
  assert.ok(/\.es-focus-inset:focus-visible\s*\{[^}]*outline-offset:\s*-4px/.test(css), "inset focus ring rule"); checks++;
  assert.ok(/--es-dim:\s*#848b98/.test(css), "contrast-safe --es-dim"); checks++;
}

console.log(`test-ui-motion: ${checks} checks passed`);
