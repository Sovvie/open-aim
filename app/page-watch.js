// Page watchers for the injected UI scripts. Each script watches the page for the menus
// it adds rows and buttons to. While the mouse is locked in a round no menu can open,
// but the HUD (timer, score) changes the page constantly and woke every watcher, so all
// of them sleep while locked. On unlock (pause, results, lobby) each watcher runs once
// to catch up on what changed meanwhile.
(() => {
  if (window.__aimWatchPage) return;
  const watchers = [];
  const locked = () => !!document.pointerLockElement;

  // ui-motion: a script that rewrites a label with the same text (el.textContent = sameText)
  // still swaps the text node, which woke every watcher; each one re-ran its sync on the next
  // frame and set the label again, so the Settings > General page re-laid out on every frame
  // forever (about 7 ms of style work per frame). Batches made only of such no-op swaps are skipped.
  const sameText = (r) => r.type === "childList" && r.addedNodes.length === 1 && r.removedNodes.length === 1 &&
    r.addedNodes[0].nodeType === 3 && r.removedNodes[0].nodeType === 3 && r.addedNodes[0].data === r.removedNodes[0].data;
  const onlyNoOps = (records) => !!records && records.length > 0 && records.every(sameText);
  window.__aimWatchPageNoOp = onlyNoOps;

  window.__aimWatchPage = (callback, options) => {
    const observer = new MutationObserver((records, obs) => { if (!onlyNoOps(records)) callback(records, obs); });
    watchers.push({ observer, callback, options });
    if (!locked()) observer.observe(document.documentElement, options);
    return observer;
  };

  document.addEventListener("pointerlockchange", () => {
    const sleep = locked();
    for (const w of watchers) {
      if (sleep) {
        w.observer.disconnect();
      } else {
        w.observer.observe(document.documentElement, w.options);
        w.callback([], w.observer);
      }
    }
  });
})();
