// Round tip (17 Nov 2026, marker aim-round-tip-v1). One short coach card on the Eliminated screen about the round that just finished,
// chosen by window.__aimCoach.roundTip() (coach.js: this round against the player's other rounds of the same drill, outliers left out).
// It reads the newest stored round with window.__aimAnalytics.rounds({ limit: 1 }) (the recorder writes its queue first), asks the coach, and
// renders nothing when the coach or the recorder is missing, the round is not found, there is too little data to compare with, or the read
// is slower than the timeouts below. The read never blocks the menu: the card is added when (and if) the answer arrives.
// Placement: the card sits directly above the action buttons (Play again ...), NOT in the column where the hit-zone panel
// (analytics-ui.js, class aim-an-hit) goes, because the wide result layout gives every extra child of the run body the same grid cell as
// that panel. On the wide layout (theme-esports.css: width >= 1180, height >= 680, the .al-pm grid) it is the last child of .al-run-actions,
// which is a column-reverse flex there, so it shows on top of the buttons; on a narrow screen it is a block before .al-run-actions.
// Every read is in try/catch. Nothing is stored. Test hooks: window.__aimRoundTip.
(() => {
  if (window.__aimRoundTip) return;

  const READ_TIMEOUT_MS = 3000;  // the newest-round read gives up after this long (same idea as analytics-ui.js)
  const TIP_TIMEOUT_MS = 6000;   // and the coach (it reads up to ROUND_LIMIT rounds) after this long (a guess, untuned)
  const FRESH_MS = 6 * 3600 * 1000; // the newest stored round must have started this recently, or it is not the one just played
  const MARK = "aim-rt-card";
  const WIDE = "(min-width: 1180px) and (min-height: 680px)";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (v) => typeof v === "number" && isFinite(v);

  const CSS = `
.${MARK} { --rt-tip: #ffb84d; box-sizing: border-box; width: 100%; margin: 12px 0 0; padding: 10px 16px 12px; background: rgba(16, 19, 26, 0.88);
  border-left: 3px solid var(--rt-tip); box-shadow: inset 0 0 0 1px var(--es-line, #272d39); color: var(--es-text, #f4f5f7);
  font: 600 12px/1.4 var(--es-head, "Bahnschrift", "Segoe UI", sans-serif); }
.${MARK} h4 { margin: 0 0 4px; font: 800 italic 11px/1.2 var(--es-head, "Bahnschrift", "Segoe UI", sans-serif); letter-spacing: 0.1em; text-transform: uppercase; color: var(--rt-tip); }
.${MARK} h5 { margin: 0 0 4px; font: 800 14px/1.25 var(--es-head, "Bahnschrift", "Segoe UI", sans-serif); color: #fff; }
.${MARK} p { margin: 0; color: var(--es-muted, #9aa1ae); font-size: 12px; line-height: 1.45; }
@media ${WIDE} { html[data-aim-local]:not(#es) body .al-result-overlay:has(> .al-pm) .${MARK} { margin: 0; } }
`;
  function injectCss() {
    try {
      if (document.getElementById("aim-round-tip-css")) return;
      const style = document.createElement("style");
      style.id = "aim-round-tip-css";
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    } catch {}
  }

  // ---------------------------------------------------------------- pure
  // The card's inner HTML for a finding, or "" when there is nothing to show.
  function cardHtml(tip) {
    if (!tip || typeof tip !== "object" || !tip.title) return "";
    return `<h4>Coach tip for this round</h4><h5>${esc(tip.title)}</h5>` + (tip.detail ? `<p>${esc(tip.detail)}</p>` : "");
  }
  const coach = () => { try { const c = window.__aimCoach; return c && typeof c.roundTip === "function" ? c : null; } catch { return null; } };
  const analytics = () => { try { const a = window.__aimAnalytics; return a && typeof a.rounds === "function" ? a : null; } catch { return null; } };
  // The answer of the promise, or null when it has not answered after ms (a hung read); a late answer is ignored.
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), ms);
      promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
  }
  async function newestRound() {
    const A = analytics();
    if (!A) return null;
    const pick = (list) => {
      const rows = Array.isArray(list) ? list.filter((r) => r && num(r.at)) : [];
      const r = rows.sort((a, b) => b.at - a.at)[0];
      return r && Date.now() - r.at < FRESH_MS ? r : null;
    };
    // The round is queued when it ends and rounds() writes the queue first. One retry covers a round-end message that arrives after the result screen.
    let r = pick(await A.rounds({ limit: 1 }));
    if (!r) { await new Promise((ok) => setTimeout(ok, 900)); r = pick(await A.rounds({ limit: 1 })); }
    return r;
  }
  // The finding for the round that just finished, or null (anything missing, thin data, a failed or slow read).
  async function loadTip() {
    try {
      const C = coach();
      if (!C || !analytics()) return null;
      const round = await withTimeout(newestRound(), READ_TIMEOUT_MS);
      if (!round) return null;
      return await withTimeout(C.roundTip(round), TIP_TIMEOUT_MS);
    } catch { return null; }
  }

  // ---------------------------------------------------------------- DOM
  const isWide = (overlay) => {
    try { return !!(window.matchMedia && window.matchMedia(WIDE).matches && overlay.querySelector(":scope > .al-pm")); } catch { return false; }
  };
  // Puts the card (created once per overlay) where the current layout wants it; rewrites its html only when it changed.
  function mount(overlay, tip) {
    const html = cardHtml(tip);
    let card = overlay.querySelector("." + MARK);
    if (!html) { if (card && card.remove) card.remove(); return null; }
    const actions = overlay.querySelector(".al-run-actions");
    if (!actions || !actions.parentElement) return null;
    if (!card) { card = document.createElement("section"); card.className = MARK; card.setAttribute("aria-label", "Coach tip for this round"); }
    if (isWide(overlay)) { if (card.parentElement !== actions || actions.lastElementChild !== card) actions.appendChild(card); }
    else if (card.parentElement !== actions.parentElement || card.nextElementSibling !== actions) actions.before(card);
    if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; }
    return card;
  }

  const state = new WeakMap(); // result overlay -> "loading" | { tip } once the answer is in
  function syncResult() {
    try {
      const overlay = document.querySelector(".al-result-overlay");
      if (!overlay || !overlay.querySelector(".al-result-verdict-splash.is-died")) return;
      const done = state.get(overlay);
      if (done === "loading") return;
      if (done) { if (done.tip) mount(overlay, done.tip); return; } // put back after the screen re-rendered, no new read
      state.set(overlay, "loading");
      loadTip().then((tip) => {
        state.set(overlay, { tip: tip || null });
        if (tip && overlay.isConnected !== false) mount(overlay, tip);
      }).catch(() => { state.set(overlay, { tip: null }); });
    } catch {}
  }

  injectCss();
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; syncResult(); }); };
  try {
    if (window.__aimWatchPage) window.__aimWatchPage(later, { childList: true, subtree: true });
    else if (typeof MutationObserver === "function" && document.body) new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  } catch {}
  syncResult();

  window.__aimRoundTip = { syncResult, render: { cardHtml, mount }, loadTip };
})();
