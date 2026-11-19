// Drives open-aim/app/menu-shortcuts.js (Esc closes the pause menu) with a fake page, game and browser.
// Fake browser rules (Chromium PointerLockController, Electron 44):
//  - Esc while the mouse is locked: the page gets no keydown, the mouse is freed, an "escape time" is noted.
//  - requestPointerLock within 1250 ms of that escape time is rejected.
// Fake game rules (OkAdunfX.js): lock lost while running -> "paused"; Resume -> "running" + requestPointerLock;
// running with a free mouse for 16 ticks (~200 ms) -> "paused" again.
// Run: node test-menu-shortcuts.cjs   (from the scratchpad folder)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "app", "menu-shortcuts.js"), "utf8");

function makeWorld({ desktop = true, setting = "on" } = {}) {
  let now = 1000;
  let timers = [];
  let nextId = 1;
  const setTimeout = (fn, ms) => { const id = nextId++; timers.push({ id, at: now + Math.max(0, ms || 0), fn }); return id; };
  const clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
  const listeners = { window: {}, document: {} };
  const add = (where) => (type, fn, opts) => {
    const capture = opts === true || !!(opts && opts.capture);
    (listeners[where][type] ||= []).push({ fn, capture });
  };

  class HTMLElement {}
  class Element extends HTMLElement {}
  const game = {
    phase: "running", lockedEl: null, escapeAt: -Infinity, dialog: false,
    resumes: 0, ourResumes: 0, gameClicks: 0, pauses: 0, failedLocks: 0, unlockedTicks: 0,
  };
  const canvas = { id: "canvas" };
  const button = new Element();
  button.disabled = false;
  button.closest = (sel) => (sel.includes("al-pause-act") ? button : null);
  button.click = () => { game.ourResumes++; gameResume(); };

  const htmlClasses = new Set();
  const document = {
    documentElement: { classList: {
      toggle(c, on) { if (on === undefined ? !htmlClasses.has(c) : on) htmlClasses.add(c); else htmlClasses.delete(c); },
      contains: (c) => htmlClasses.has(c),
    }, appendChild() {} },
    head: { appendChild() {} },
    createElement: () => ({}),
    get pointerLockElement() { return game.lockedEl; },
    addEventListener: add("document"),
    querySelector(sel) {
      if (sel.includes("al-pause-layer")) return game.phase === "paused" && !game.dialog ? button : null;
      if (sel.includes("hall-dialog-mask")) return game.dialog ? {} : null;
      return null;
    },
    querySelectorAll: () => [],
  };
  const storage = { "aim-pause-esc-close-v1": setting };
  const localStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } };
  const window = {
    addEventListener: add("window"),
    __aimDesktop: desktop ? {
      // main.js: ipcMain "aim:gesture-run" -> executeJavaScript(resumeNow(), userGesture=true), a few ms later
      runWithGesture(name) { if (name === "pause-resume") setTimeout(() => window.__aimMenuShortcuts.resumeNow(), 4); },
    } : undefined,
  };

  function dispatch(type, init, phases = ["window-capture", "document-capture", "target", "document-bubble", "window-bubble"]) {
    const ev = {
      type, defaultPrevented: false, stopped: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false,
      isTrusted: true, target: null, ...init,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const phase of phases) {
      if (phase === "target") { if (ev.onTarget && !ev.stopped) ev.onTarget(ev); continue; }
      const [where, kind] = phase.split("-");
      for (const l of listeners[where][type] || []) {
        if (ev.stopped) return ev;
        if (l.capture === (kind === "capture")) l.fn(ev);
      }
    }
    return ev;
  }
  const lockChange = () => dispatch("pointerlockchange", {});

  function gameResume() {
    if (game.phase !== "paused") return;
    game.resumes++;
    game.phase = "running";
    game.unlockedTicks = 0;
    // requestPointerLock: async grant or reject
    setTimeout(() => {
      if (now < game.escapeAt + 1250) { game.failedLocks++; return; }
      if (game.phase !== "running") return;
      game.lockedEl = canvas; lockChange();
    }, 8);
  }
  function gamePause() { if (game.phase === "running") { game.phase = "paused"; game.pauses++; } }

  // Game tick every 12.5 ms: running with a free mouse for 16 ticks -> paused.
  function tick() {
    if (game.phase === "running" && !game.lockedEl) { if (++game.unlockedTicks >= 16) { game.unlockedTicks = 0; gamePause(); } }
    else game.unlockedTicks = 0;
    setTimeout(tick, 12.5);
  }

  function advance(ms) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  }

  // Player presses Esc and holds it for `hold` ms.
  function pressEsc(hold = 90, { autoRepeat = false } = {}) {
    if (game.lockedEl) {
      // browser takes the keydown: frees the mouse; the page gets only pointerlockchange
      game.escapeAt = now;
      game.lockedEl = null;
      lockChange();
      if (game.phase === "running") gamePause(); // onLockLost
    } else {
      dispatch("keydown", { key: "Escape", code: "Escape" });
    }
    if (autoRepeat) {
      for (let t = 500; t < hold; t += 33) {
        advance(33);
        if (game.lockedEl) { game.escapeAt = now; game.lockedEl = null; lockChange(); if (game.phase === "running") gamePause(); }
        else dispatch("keydown", { key: "Escape", code: "Escape", repeat: true });
      }
      advance(Math.max(0, hold - 500));
    } else advance(hold);
    if (game.lockedEl) { game.escapeAt = now; game.lockedEl = null; lockChange(); if (game.phase === "running") gamePause(); }
    else dispatch("keyup", { key: "Escape", code: "Escape" });
  }
  // A real mouse click on the Resume button.
  function clickResume() {
    if (game.phase !== "paused") return;
    dispatch("click", { target: button, onTarget: () => { game.gameClicks++; gameResume(); } });
  }

  const ctx = {
    window, document, localStorage, HTMLElement, Element, setTimeout, clearTimeout,
    performance: { now: () => now }, requestAnimationFrame: (fn) => setTimeout(fn, 16), console,
  };
  ctx.window.document = document;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  window.__aimMenuShortcuts = ctx.window.__aimMenuShortcuts;
  // start a round with the mouse locked
  game.lockedEl = canvas; lockChange();
  tick();
  advance(2000);
  // "menu on screen" = the game shows it and the script has not hidden it (html.aim-esc-resuming)
  const menuVisible = () => game.phase === "paused" && !htmlClasses.has("aim-esc-resuming");
  return { game, advance, pressEsc, clickResume, dispatch, gameResume, storage, menuVisible, hidden: () => htmlClasses.has("aim-esc-resuming"), get now() { return now; } };
}

let pass = 0, fail = 0;
function check(name, cond, info = "") {
  if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); }
}
const state = (g) => `phase=${g.phase} locked=${!!g.lockedEl} resumes=${g.resumes} ours=${g.ourResumes} pauses=${g.pauses} failedLocks=${g.failedLocks}`;

// 1. First Esc opens the menu; the script does not close it again by itself.
{
  const w = makeWorld();
  w.pressEsc();
  check("1a first Esc pauses", w.game.phase === "paused" && !w.game.lockedEl, state(w.game));
  w.advance(3000);
  check("1b menu stays open, no resume of our own", w.game.phase === "paused" && w.game.ourResumes === 0, state(w.game));
}

// 2. Quick double Esc (2nd press 300 ms after the 1st): one resume, once the browser allows the lock; no reopen.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(300);
  const firstEsc = w.game.escapeAt;
  w.pressEsc();
  check("2a menu gone from the screen right after the 2nd Esc, resume waiting out the lock cooldown",
    !w.menuVisible() && w.hidden() && w.game.phase === "paused" && w.game.ourResumes === 0 && w.game.failedLocks === 0, state(w.game));
  let lockedAt = null;
  for (let t = 0; t < 1200 && lockedAt === null; t += 2) { w.advance(2); if (w.game.lockedEl) lockedAt = w.now; }
  check("2b resumed and mouse locked", w.game.phase === "running" && !!w.game.lockedEl, state(w.game));
  check("2d resumed within 1.28 s of the first Esc (was 1.3 s + margin)", lockedAt !== null && lockedAt - firstEsc <= 1280, `locked ${lockedAt === null ? "never" : lockedAt - firstEsc} ms after the 1st Esc`);
  w.advance(3000);
  check("2c exactly one resume, no failed lock, no reopen, menu not hidden any more", w.game.ourResumes === 1 && w.game.failedLocks === 0 && w.game.pauses === 1 && w.game.phase === "running" && !w.hidden(), state(w.game));
}

// 3. Slow double Esc (2nd press 2 s later): resumes right on key release.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000);
  w.pressEsc();
  w.advance(40);
  check("3a resumed within 40 ms of the keyup", w.game.phase === "running" && !!w.game.lockedEl && w.game.ourResumes === 1, state(w.game));
  w.advance(3000);
  check("3b no reopen", w.game.phase === "running" && w.game.pauses === 1, state(w.game));
}

// 4. Third Esc after resuming opens the menu again (and the old retry does not close it).
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000); w.pressEsc(); w.advance(100);
  w.pressEsc();
  check("4a third Esc pauses again", w.game.phase === "paused", state(w.game));
  w.advance(3000);
  check("4b and the menu stays open", w.game.phase === "paused" && w.game.ourResumes === 1, state(w.game));
}

// 5. Mashing Esc while the menu is open: still a single resume.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(200);
  w.pressEsc(60); w.advance(100); w.pressEsc(60); w.advance(100); w.pressEsc(60);
  w.advance(3000);
  check("5 three presses in the menu = one resume, running, no reopen", w.game.ourResumes === 1 && w.game.phase === "running" && w.game.pauses === 1 && !!w.game.lockedEl, state(w.game));
}

// 6. Holding the 2nd Esc down (auto-repeat) resumes once, after release.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000);
  w.pressEsc(1500, { autoRepeat: true });
  w.advance(3000);
  check("6 held Esc: one resume after release, no reopen", w.game.ourResumes === 1 && w.game.phase === "running" && w.game.pauses === 1, state(w.game));
}

// 7. Mouse click on Resume inside the cooldown is held and replayed: one click is enough.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(400);
  w.clickResume();
  check("7a click held (game handler not run inside the cooldown), menu hidden at once", w.game.gameClicks === 0 && w.game.phase === "paused" && !w.menuVisible(), state(w.game));
  w.advance(3000);
  check("7b one click resumed, no failed lock, no reopen", w.game.phase === "running" && !!w.game.lockedEl && w.game.failedLocks === 0 && w.game.pauses === 1, state(w.game));
}

// 8. Mouse click on Resume after the cooldown goes straight to the game.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000);
  w.clickResume();
  w.advance(100);
  check("8 click after cooldown handled by the game itself", w.game.gameClicks === 1 && w.game.ourResumes === 0 && w.game.phase === "running", state(w.game));
}

// 9. A dialog (Settings, .hall-dialog-mask) is open over the menu: Esc is left to it.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000);
  w.game.dialog = true;
  w.pressEsc();
  w.advance(3000);
  check("9 dialog open: no resume, menu not hidden", w.game.ourResumes === 0 && w.game.phase === "paused" && !w.hidden(), state(w.game));
}

// 10. Buy menu: its capture handler stops Esc; nothing here runs.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000);
  // emulate the buy menu's window capture listener with stopImmediatePropagation
  const ev = w.dispatch("keydown", { key: "Escape", code: "Escape", defaultPrevented: true });
  w.dispatch("keyup", { key: "Escape", code: "Escape" });
  w.advance(3000);
  check("10 Esc already handled (defaultPrevented): no resume", w.game.ourResumes === 0 && w.game.phase === "paused" && ev, state(w.game));
}

// 11. Setting Off: Esc does nothing in the menu.
{
  const w = makeWorld({ setting: "off" });
  w.pressEsc(); w.advance(2000);
  w.pressEsc();
  w.advance(3000);
  check("11 setting off: no resume, menu stays visible", w.game.ourResumes === 0 && w.menuVisible(), state(w.game));
}

// 12. Plain browser (no desktop bridge): resume clicks Resume directly, same timing.
{
  const w = makeWorld({ desktop: false });
  w.pressEsc(); w.advance(300);
  w.pressEsc();
  w.advance(3000);
  check("12 no bridge: one resume, no reopen", w.game.ourResumes === 1 && w.game.phase === "running" && w.game.pauses === 1, state(w.game));
}

// 13. Model check (the reported bug): resuming straight away inside the cooldown, as the previous version did on
// keyup, is refused by the browser and the game pauses again by itself: the menu "reopens".
{
  const w = makeWorld();
  w.pressEsc(); w.advance(300);
  w.gameResume();
  w.advance(500);
  check("13 model: immediate resume -> lock refused -> menu back", w.game.failedLocks === 1 && w.game.phase === "paused" && w.game.pauses === 2, state(w.game));
}

// 14. Slow double Esc, looked at keydown by keydown: the menu leaves the screen on the press itself, the game's
// Resume (the button's own click) runs on the release, and nothing is hidden afterwards.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000);
  w.dispatch("keydown", { key: "Escape", code: "Escape" });
  check("14a menu off screen on the keydown itself (before the release)", !w.menuVisible() && w.game.ourResumes === 0, state(w.game));
  w.advance(80);
  w.dispatch("keyup", { key: "Escape", code: "Escape" });
  w.advance(30);
  check("14b resumed by the Resume button's own click right after the release", w.game.ourResumes === 1 && w.game.phase === "running" && !!w.game.lockedEl, state(w.game));
  w.advance(500);
  check("14c no leftover hiding", !w.hidden(), state(w.game));
}

// 15. A dialog opens while the hidden menu waits for the cooldown: nothing resumes and the menu comes back.
{
  const w = makeWorld();
  w.pressEsc(); w.advance(300);
  w.pressEsc();
  w.game.dialog = true;
  w.advance(3000);
  w.game.dialog = false;
  check("15 dialog during the wait: no resume, menu shown again", w.game.ourResumes === 0 && w.menuVisible(), state(w.game));
}

// 16. Model check: taking the mouse back on the keydown, while Esc is still down, is undone by that same Esc (why the
// resume itself stays on the release).
{
  const w = makeWorld();
  w.pressEsc(); w.advance(2000);
  w.game.phase = "paused";
  w.gameResume(); // lock granted 8 ms later, key still down
  w.advance(60);
  // release while locked: the fake browser treats it as Esc again
  if (w.game.lockedEl) { w.game.escapeAt = w.now; w.game.lockedEl = null; w.dispatch("pointerlockchange", {}); if (w.game.phase === "running") { w.game.phase = "paused"; w.game.pauses++; } }
  check("16 model: lock taken while Esc is down -> freed by it -> menu back", w.game.phase === "paused" && w.game.pauses === 2, state(w.game));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
