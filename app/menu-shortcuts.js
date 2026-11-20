// Menu shortcuts (16 Nov 2026, marker aim-menu-shortcuts-v1). Two keyboard shortcuts for the in-round menus,
// each with an On / Off row in Settings > General > Mouse (new "Menu shortcuts" heading under Invert mouse).
// Saved on this PC in localStorage; a missing value means On:
//   "aim-eliminated-restart-v1"  "on" | "off"   T (the player's own Restart key) on the Eliminated screen = Play again.
//   "aim-pause-esc-close-v1"     "on" | "off"   Esc while the Paused / Tab menu is open = Resume: the menu goes on the key press,
//                                               the game's Resume runs on release (not before the browser's 1.25 s lock
//                                               cooldown after an Esc unlock; see below).
// The game's own Restart key handler ignores the result screen, so T needs this; it clicks the screen's own
// "Play again" button, so the round starts exactly as with the mouse. Neither shortcut acts while a dialog is open,
// a key is being captured in Controls, or the game already handled the key (defaultPrevented).
(() => {
  if (window.__aimMenuShortcuts) return;
  const RESTART_KEY = "aim-eliminated-restart-v1";
  const ESC_KEY = "aim-pause-esc-close-v1";
  const read = (key) => { try { return localStorage.getItem(key) !== "off"; } catch { return true; } };
  const write = (key, on) => { try { localStorage.setItem(key, on ? "on" : "off"); } catch {} };
  // Key chips (20 Nov 2026): attributes on <html> that show each shortcut on its button while it is on.
  const RESTART_CHIP = "data-aim-restart-chip";
  const ESC_CHIP = "data-aim-esc-resume";
  // A keyboard code as a key-cap label: "KeyT" -> "T", "Digit5" -> "5", "Numpad5" -> "Num 5", "F5" -> "F5".
  const keyLabel = (code) => {
    const c = String(code || "");
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^Numpad\d$/.test(c)) return "Num " + c.slice(6);
    return c.replace(/(Left|Right)$/, "").slice(0, 8);
  };

  const overlay = () => document.querySelector(".al-result-overlay");
  // The verdict splash keeps its "is-died" class for as long as the result screen is up.
  const eliminated = () => !!overlay()?.querySelector(".al-result-verdict-splash.is-died");
  const playAgainButton = () => {
    const root = overlay();
    if (!root) return null;
    const buttons = [...root.querySelectorAll("button")];
    return buttons.find((b) => /^play again$/i.test(b.textContent.trim())) || root.querySelector(".al-primary-btn") || null;
  };
  const pauseResumeButton = () => document.querySelector(".al-pause-layer .al-pause-act.is-primary");

  // The player's Restart binding (default T); only keyboard codes count here.
  const restartCodes = () => {
    let list = null;
    try { const saved = JSON.parse(localStorage.getItem("al-keybinds-v1") ?? "null"); if (saved && Array.isArray(saved.restart)) list = saved.restart; } catch {}
    list ??= (Array.isArray(window.__aimKeybinds?.restart) ? window.__aimKeybinds.restart : null) ?? ["KeyT", null];
    return list.filter((code) => typeof code === "string" && !/^(Mouse|Wheel)/.test(code));
  };

  const typing = (target) => target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
  // Settings, crosshair studio, buy menu etc. sit in .hall-dialog-mask; a Controls key capture shows .is-capturing.
  const dialogOpen = () => !!document.querySelector(".hall-dialog-mask, .kb-cap.is-capturing");

  let lastRestart = 0;
  // Esc closes the pause menu (17 Nov 2026, second fix). What happens in the desktop app (Electron 44 ships Chromium's
  // ExclusiveAccessManager / PointerLockController, pointer_lock_controller.cc is in electron.exe):
  //  1st Esc, mouse locked: the browser takes the key itself (the page gets no keydown), frees the mouse and notes the time.
  //     pointerlockchange -> game onLockLost (OkAdunfX.js) -> phase "paused" -> the menu. The page sees only that Esc's keyup.
  //  2nd Esc, mouse free: keydown and keyup reach the page. Resume = the game's Resume button -> engine start ->
  //     requestPointerLock. Chromium REJECTS every lock request for 1.25 s after the user freed the mouse with Esc, user
  //     gesture or not. The round is then running with a free mouse, the game's tick check kt() pauses it again after
  //     16 ticks and the menu "reopens"; a Resume click inside that window fails the same way (hence "click Resume twice").
  //  Esc while the mouse is locked frees it again, so the lock must also not be taken back while Esc is still down.
  // So: arm on keydown (menu open, mouse free), resume on keyup, but never before lastUnlock + LOCK_COOLDOWN_MS; a Resume
  // click inside that window is held and replayed when it ends. Exactly one resume per press; one retry if the game shows
  // the menu again before the mouse was ever taken back.
  // Instant close (17 Nov 2026, third fix): the menu used to stay on screen for that whole wait (up to ~1.3 s). Now the
  // keydown (or a held Resume click) hides it at once (html.aim-esc-resuming: invisible, clicks pass to nothing in it) and
  // the resume that follows is the Resume button's own click (resumeNow), the same code path, with a user gesture. The
  // real resume stays on the release: a lock taken while Esc is still down is freed again by that Esc.
  const LOCK_COOLDOWN_MS = 1260; // Chromium's 1250 ms, counted from our pointerlockchange (already later than its own stamp)
  const RETRY_AFTER_MS = 450;
  const HIDE_CLASS = "aim-esc-resuming";
  const HIDE_MAX_MS = LOCK_COOLDOWN_MS + 500; // the menu never stays hidden longer than this without a resume
  try {
    const style = document.createElement("style");
    style.id = "aim-esc-resuming-style";
    style.textContent = `html.${HIDE_CLASS} .al-pause-layer { opacity: 0 !important; transition: none !important; }
html.${HIDE_CLASS} .al-pause-layer * { pointer-events: none !important; }
/* ui-result (20 Nov 2026): the Eliminated screen's Play again shows the Restart key as a chip while that shortcut is on
   (::before, the theme uses ::after for the button's shine); the Esc chip on Resume is in ui.css */
html[data-aim-local][${RESTART_CHIP}]:not(#es) body .al-result-overlay:has(> .al-result-verdict-splash.is-died) .al-run-actions .al-primary-btn::before {
  content: var(--aim-restart-key, "T"); position: absolute; right: 26px; top: 50%; transform: translateY(-50%); padding: 1px 6px;
  font: 700 11px/1.4 var(--es-head, "Bahnschrift", sans-serif); font-style: normal; letter-spacing: 0.04em; text-transform: uppercase;
  color: #fff; background: rgba(0, 0, 0, 0.22); border: 1px solid rgba(255, 255, 255, 0.35); pointer-events: none; }`;
    (document.head || document.documentElement).appendChild(style);
  } catch {}
  let hideTimer = 0;
  function hideMenu(on) {
    clearTimeout(hideTimer);
    hideTimer = on ? setTimeout(() => hideMenu(false), HIDE_MAX_MS) : 0;
    try { document.documentElement.classList.toggle(HIDE_CLASS, on); } catch {}
  }
  let lastUnlock = -Infinity;    // last time the mouse was freed
  let lastLock = -Infinity;      // last time the mouse was taken
  let armed = false;             // an Esc keydown that may resume was seen, its keyup is pending
  let pending = 0;               // timer of a scheduled resume (0: none)
  let retryTimer = 0;
  let resumeAt = -Infinity;      // time of the last resume we ran
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) lastLock = performance.now(); else lastUnlock = performance.now();
  });
  const locked = () => !!document.pointerLockElement;
  // The menu is up, nothing covers it and the mouse is free: a resume can work.
  const canResume = () => !dialogOpen() && !!pauseResumeButton() && !locked();

  // Bubble phase on window: runs after the game's own document-level handlers, so defaultPrevented is meaningful.
  // The buy menu (capture on window) stops its own Esc with stopImmediatePropagation, so it never gets here.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || typing(event.target)) return;
    if (event.key === "Escape") {
      if (!read(ESC_KEY) || !canResume()) return;
      // In case a browser does deliver the Esc that freed the mouse: that same press must not close the menu again.
      if (performance.now() - lastUnlock < 250) return;
      event.preventDefault();
      armed = true; // resumes on keyup, see above
      hideMenu(true); // the menu goes now, like on a Resume click
    } else if (restartCodes().includes(event.code)) {
      if (!read(RESTART_KEY) || dialogOpen() || !eliminated()) return;
      const now = performance.now();
      if (now - lastRestart < 700) return;
      const button = playAgainButton();
      if (!button || button.disabled) return;
      lastRestart = now;
      event.preventDefault();
      button.click(); // a letter key counts as a user gesture, so the new round can take the mouse
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.key !== "Escape" || !armed) return; // the keyup of the Esc that opened the menu has no armed keydown: ignored
    armed = false;
    if (!read(ESC_KEY) || !canResume()) { if (!pending) hideMenu(false); return; }
    event.preventDefault();
    schedule(true);
  });
  window.addEventListener("blur", () => { if (armed && !pending) hideMenu(false); armed = false; });

  // A real click on Resume inside the lock cooldown would be rejected by the browser and the menu would come back:
  // hold it and resume once the cooldown is over. Our own click (resumeNow, not trusted) and later clicks pass through.
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    if (!event.target.closest(".al-pause-layer .al-pause-act.is-primary")) return;
    if (cooldownLeft() <= 0 || !canResume()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    schedule(true);
  }, true);

  const cooldownLeft = () => lastUnlock + LOCK_COOLDOWN_MS - performance.now();
  // One resume, at the earliest moment the browser will grant the mouse. Repeated Esc presses or clicks while one is
  // waiting just keep that single resume.
  function schedule(allowRetry) {
    clearTimeout(pending);
    const wait = Math.max(0, cooldownLeft());
    if (wait > 0) hideMenu(true); // the menu is gone while the browser still refuses the mouse
    pending = setTimeout(() => { pending = 0; run(allowRetry); }, wait);
  }
  function run(allowRetry) {
    if (!canResume()) { hideMenu(false); return; }
    resumeAt = performance.now();
    requestResume();
    // Shown again once the game has taken the menu down (phase "running"); if the browser refused the mouse after all and
    // the game shows the menu again, it is visible (and the retry below hides it while it waits).
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hideMenu(false), 120);
    clearTimeout(retryTimer);
    if (!allowRetry) return;
    // If the mouse was never taken back (lock refused) and the game shows the menu again, try once more. Once the
    // mouse was taken after this resume, any later pause is the player's own (a new Esc) and is left alone.
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      if (pending || armed || lastLock > resumeAt || !canResume()) return;
      schedule(false);
    }, RETRY_AFTER_MS);
  }

  // Esc is not a user gesture for the browser, and Resume has to take the mouse back. In the desktop app the
  // main process runs resumeNow() below with a gesture (webContents.executeJavaScript(…, true)); in a plain
  // browser the page just clicks Resume.
  function requestResume() {
    const bridge = window.__aimDesktop;
    if (bridge && typeof bridge.runWithGesture === "function") { try { bridge.runWithGesture("pause-resume"); return; } catch {} }
    resumeNow();
  }
  function resumeNow() {
    if (!canResume()) return false; // the menu closed, a dialog opened or the mouse is back meanwhile
    const button = pauseResumeButton();
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  // ---- Settings rows (modelled on scope-zoom-setting.js) ----
  function makeRow(anchor, scope, cls, name, hint, key) {
    const row = document.createElement("div");
    row.className = `hall-field hall-choice ${cls}`; row.dataset.setting = name;
    row.innerHTML = `<span class="hall-field-text"><b></b><small></small></span><div class="hall-choice-options" role="radiogroup"></div>`;
    row.querySelector("b").textContent = hint.label; row.querySelector("small").textContent = hint.text;
    row.lastElementChild.setAttribute("aria-label", hint.label);
    for (const [value, label] of [["on", "On"], ["off", "Off"]]) {
      const b = document.createElement("button"); b.type = "button"; b.role = "radio"; b.dataset.value = value; b.textContent = label;
      b.onclick = () => { write(key, value === "on"); sync(); };
      row.lastElementChild.append(b);
    }
    for (const el of [row, ...row.querySelectorAll("*")]) for (const a of scope) el.setAttribute(a, "");
    return row;
  }
  function syncChips() {
    try {
      const html = document.documentElement;
      const escOn = read(ESC_KEY), first = read(RESTART_KEY) ? restartCodes()[0] : null;
      if (html.hasAttribute(ESC_CHIP) !== escOn) html.toggleAttribute(ESC_CHIP, escOn);
      if (html.hasAttribute(RESTART_CHIP) !== !!first) html.toggleAttribute(RESTART_CHIP, !!first);
      const label = first ? JSON.stringify(keyLabel(first)) : "";
      if (html.style.getPropertyValue("--aim-restart-key") !== label) { if (label) html.style.setProperty("--aim-restart-key", label); else html.style.removeProperty("--aim-restart-key"); }
    } catch {}
  }
  function sync() {
    syncChips();
    for (const anchor of document.querySelectorAll('[data-setting="invertMouseY"]')) {
      let head = anchor.nextElementSibling?.matches?.(".aim-menu-keys-head") ? anchor.nextElementSibling : null;
      if (!head) {
        const scope = [...anchor.attributes].filter((a) => a.name.startsWith("data-v-")).map((a) => a.name);
        head = document.createElement("h3"); head.className = "hall-dialog-section aim-menu-keys-head";
        head.append("Menu shortcuts ");
        const note = document.createElement("small"); note.className = "hall-dialog-section-note"; note.textContent = "Keyboard only; no effect on shots or scores";
        head.append(note);
        for (const el of [head, note]) for (const a of scope) el.setAttribute(a, "");
        const restartRow = makeRow(anchor, scope, "aim-restart-eliminated-row", "eliminatedRestart",
          { label: "Restart key on the Eliminated screen", text: "Press your Restart key (T by default) after you are eliminated to start the next round, instead of clicking Play again." }, RESTART_KEY);
        const escRow = makeRow(anchor, scope, "aim-esc-close-pause-row", "pauseEscClose",
          { label: "Esc closes the pause menu", text: "Press Esc again while the pause menu is open to resume the round. The first Esc still opens it." }, ESC_KEY);
        anchor.after(head, restartRow, escRow);
      }
      for (const [cls, key] of [[".aim-restart-eliminated-row", RESTART_KEY], [".aim-esc-close-pause-row", ESC_KEY]]) {
        const row = head.parentElement?.querySelector(cls); if (!row) continue;
        const on = read(key);
        for (const b of row.querySelectorAll("button")) { const active = (b.dataset.value === "on") === on; b.classList.toggle("is-active", active); b.setAttribute("aria-checked", String(active)); }
      }
    }
  }
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); };
  if (window.__aimWatchPage) window.__aimWatchPage(later, { childList: true, subtree: true });
  sync();

  window.__aimMenuShortcuts = { resumeNow, keyLabel, syncChips, hidden: () => { try { return document.documentElement.classList.contains(HIDE_CLASS); } catch { return false; } }, read: (which) => read(which === "esc" ? ESC_KEY : RESTART_KEY) };
})();
