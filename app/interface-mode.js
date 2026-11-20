// Interface mode: "Enhanced" (default, the full theme) or "Performance", set in
// Settings > Video > Smoothness. Performance turns off the glass blur behind panels
// and stops looping animations in rounds (the lobby is skipped under a round in both modes)
// (the rules are in theme-esports.css under html[data-es-ui="performance"]). Mostly a
// look preference: on test PCs it did not change FPS measurably. Saved in
// localStorage, so it is per PC like the game's own video settings.
(() => {
  if (window.__aimInterfaceMode) return;
  window.__aimInterfaceMode = true;

  const KEY = "es-ui-mode";
  const MODES = [
    { id: "performance", label: "Performance", title: "Solid panels, no blur and no looping animations" },
    { id: "enhanced", label: "Enhanced", title: "Glass blur and animations, the full look" },
  ];

  function current() {
    try { return localStorage.getItem(KEY) === "performance" ? "performance" : "enhanced"; } catch { return "enhanced"; }
  }

  function apply(mode) {
    document.documentElement.dataset.esUi = mode;
  }

  function set(mode) {
    try { localStorage.setItem(KEY, mode); } catch {}
    apply(mode);
    for (const b of document.querySelectorAll(".es-ui-mode button")) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", String(on));
    }
  }

  apply(current());

  // A row like the game's own (copied from Frame rate, including its scoped-style
  // attribute), placed first under the Smoothness heading. The game renamed "frameMode" to
  // "frameRate"; without the new name the row was never added and Performance could not be
  // switched back off (ui-settings review, 20 Nov 2026).
  function addRow() {
    const frameMode = document.querySelector('[data-setting="frameRate"], [data-setting="frameMode"]');
    const list = frameMode ? frameMode.parentElement : null;
    if (!list || list.querySelector(".es-ui-mode")) return;
    const heading = [...list.children].find((el) => el.matches("h3.hall-dialog-section") && /Smoothness/.test(el.textContent));
    const scoped = [...frameMode.attributes].filter((a) => a.name.startsWith("data-v-")).map((a) => a.name);
    const row = document.createElement("div");
    row.className = "hall-field hall-choice es-ui-mode";
    row.dataset.setting = "esUiMode";
    row.dataset.focus = "esUiMode"; // the settings search's entry for this row (tools/patch-settings-wording.cjs)
    for (const a of scoped) row.setAttribute(a, "");
    row.innerHTML =
      '<span class="hall-field-text"><span class="hall-field-head"><b>Interface</b>' +
      '<em class="hall-field-local" title="Saved on this PC only">This PC only</em></span>' +
      "<small>Enhanced: glass blur and animations. Performance: solid panels and fewer effects, can help a little on some PCs</small></span>" +
      '<div class="hall-choice-options" role="radiogroup" aria-label="Interface"></div>';
    const options = row.querySelector(".hall-choice-options");
    const mode = current();
    for (const m of MODES) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.mode = m.id;
      b.title = m.title;
      b.textContent = m.label;
      b.classList.toggle("is-active", m.id === mode);
      b.setAttribute("aria-checked", String(m.id === mode));
      b.addEventListener("click", () => set(m.id));
      options.appendChild(b);
    }
    (heading ? heading.nextElementSibling : frameMode).before(row);
  }

  // html.es-on-settings while the lobby's Settings page is shown: theme-esports.css hides the
  // Discord dock there, which otherwise covered the right-hand controls (toggles, slider values).
  function markSettings() {
    const on = !!document.querySelector(".hall-body > .st-view");
    if (document.documentElement.classList.contains("es-on-settings") !== on) document.documentElement.classList.toggle("es-on-settings", on);
  }

  let queued = false;
  window.__aimWatchPage(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      addRow();
      markSettings();
    });
  }, { childList: true, subtree: true });
  addRow();
  markSettings();
})();
