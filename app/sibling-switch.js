// Switch difficulty (16 Nov 2026, marker aim-sibling-switch-v1). On the result screen (Eliminated / Cleared / Time's
// up) and in the Esc pause menu, a "Switch difficulty" button leaves the round and starts the same drill's other
// difficulty. A drill's sibling is the scenarios/ file pair <stem>-easy.json / <stem>-hard.json; scripts/build-scenarios.mjs
// records the pairs in app/training-set.json and main.js answers /api/local/drill-sibling?code=<shareCode> with the
// sibling's code and name (nothing when the drill has no pair, and then no button is added).
//
// How the round is started: the game has no URL or API for it. The lobby card's Start button runs the game's own start
// function (it loads the scene into the training layer, no page navigation), the same way studio-launch.js starts a
// Studio drill. So this clicks the screen's own Exit button (back to the lobby, which stays mounted under the round),
// waits for the training layer to go, then clicks the sibling's lobby card Start button. The player then lands on the
// sibling's normal start screen. Your settings (sensitivity, crosshair, display, audio, keys, pause-menu toggles) are
// global, so they carry over; the per-drill Enemy rank pick belongs to each card and is not copied to the sibling.
//
// The buttons are shallow clones of the screen's own buttons (result: its Exit button; pause menu: its Restart button),
// so they take that screen's classes and scoped styling with no CSS of their own.
(() => {
  if (window.__aimSiblingSwitch) return;
  window.__aimSiblingSwitch = true;
  const API = "/api/local/drill-sibling";
  const MARK = "aim-sibling-switch";

  // The drill being played: the game announces each scene it loads from a lobby card or link (Studio drills started by
  // studio-launch.js too, they use the same Start button) with its share code. Imported scene files and review play are
  // not announced, so after one of those this still holds the previous drill's code.
  let current = null;
  window.addEventListener("aim-local-scene", (event) => { current = event.detail && event.detail.id ? String(event.detail.id) : null; });

  const known = new Map(); // shareCode -> { code, name, difficulty } | null (no sibling)
  const asking = new Set();
  function lookup(code) {
    if (known.has(code) || asking.has(code) || !/^[a-z0-9-]{1,64}$/i.test(code)) return;
    asking.add(code);
    fetch(`${API}?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { known.set(code, data && /^[a-f0-9]{16}$/.test(data.code || "") ? data : null); })
      .catch(() => {}) // the service did not answer: ask again at the next menu
      .finally(() => { asking.delete(code); later(); });
  }

  const resultRoot = () => document.querySelector(".al-result-overlay");
  const playAgain = (root) => [...root.querySelectorAll("button")].find((b) => /^play again$/i.test(b.textContent.trim())) || null;
  // Result screen: the Exit button sits in the same row as Play again.
  const resultExit = () => {
    const root = resultRoot(), play = root && playAgain(root);
    if (!play) return null;
    return [...play.parentElement.children].find((el) => el !== play && el.tagName === "BUTTON" && !el.classList.contains(MARK)
      && (el.dataset.action === "exit" || el.classList.contains("al-secondary-btn"))) || null;
  };
  const pauseRoot = () => document.querySelector(".al-pause-layer");
  const pauseExit = () => pauseRoot()?.querySelector(`.al-pause-act.is-exit:not(.${MARK})`) || null;

  const exitButton = () => (resultRoot() ? resultExit() : pauseRoot() ? pauseExit() : null);

  function labelOf(info) {
    const d = String(info.difficulty || "").toLowerCase();
    return d === "easy" || d === "hard" ? `Switch difficulty: ${d[0].toUpperCase()}${d.slice(1)}` : "Switch difficulty";
  }
  function mount(exit, info, before) {
    const parent = exit.parentElement;
    let button = parent.querySelector(`.${MARK}`);
    if (!button) {
      const template = before === "exit" ? parent.querySelector(".al-pause-act.is-second") || exit : exit;
      button = template.cloneNode(false); // classes + data-v-* scope attributes only; no text, no listeners
      button.removeAttribute("data-action"); button.removeAttribute("id"); button.removeAttribute("disabled");
      button.classList.remove("is-exit", "is-primary");
      button.classList.add(MARK);
      button.type = "button";
      button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); begin(); });
      if (before === "exit") parent.insertBefore(button, exit); else exit.after(button);
    }
    const text = labelOf(info);
    if (button.textContent !== text) button.textContent = text;
    button.title = info.name ? `Play ${info.name}` : "";
    button.dataset.code = info.code;
  }

  function sync() {
    const code = current;
    const exit = code ? exitButton() : null;
    if (!exit) return;
    if (!known.has(code)) { lookup(code); return; }
    const info = known.get(code);
    if (info) mount(exit, info, resultRoot() ? "after" : "exit");
  }
  let queued = false;
  function later() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sync(); }); }
  if (window.__aimWatchPage) window.__aimWatchPage(later, { childList: true, subtree: true });
  sync();

  // ---- the switch ----
  let busy = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function begin() {
    const info = current ? known.get(current) : null;
    const exit = exitButton();
    if (busy || !info || !exit) return;
    busy = true;
    try {
      exit.click(); // the screen's own Exit: back to the lobby
      const until = Date.now() + 15000;
      while (Date.now() < until && document.querySelector(".al-aimlab-root")) await wait(100);
      if (document.querySelector(".al-aimlab-root")) return;
      // The first top tab is VALORANT Training, where these drills are listed (same as studio-launch.js).
      const tab = document.querySelector(".hall-tab");
      if (tab && !tab.classList.contains("is-active")) tab.click();
      const ballAt = Date.now() + 2500; // a Target Workshop (ball) drill has no card in the VALORANT tab: look in the Target Workshop tab after a moment
      let ballTab = false;
      while (Date.now() < until) {
        const card = document.querySelector(`[data-role="workshop-card"][data-share-code="${info.code}"]`);
        const go = card && card.querySelector(".al-wk-split-go, .al-wk-go");
        if (card) card.scrollIntoView({ block: "center" });
        if (go) { go.click(); return; }
        if (!card && Date.now() > ballAt) {
          if (!ballTab) {
            ballTab = true;
            const tw = [...document.querySelectorAll("button.hall-tab, [data-action='tab-ball']")].find((b) => /target workshop/i.test(b.textContent) || b.dataset.action === "tab-ball");
            if (tw && !tw.classList.contains("is-active")) tw.click();
          }
          const twCard = document.querySelector(`.tw-card[data-code="${info.code}"]`), twGo = twCard && twCard.querySelector('[data-act="play"]');
          if (twCard && twCard.scrollIntoView) twCard.scrollIntoView({ block: "center" });
          if (twGo) { twGo.click(); return; }
        }
        await wait(150);
      }
      console.warn(`Switch difficulty: no lobby card for ${info.code} (is a search filter hiding it?)`);
    } finally { busy = false; }
  }

  window.__aimSiblingSwitch = { current: () => current, sibling: (code) => known.get(code ?? current) ?? null };
})();
