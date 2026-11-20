// Collection: a lobby tab for weapon skins (option B, full-screen picker).
// Pictures are pre-rendered stills in /aim-ui/collection/ (made once from the game's own
// skin models by previews/skin-renders/), so the page draws no 3D and costs no frame time.
// It is only built while open and is removed when closed or when a round starts.
// Equip writes the same keys the old Settings > Visuals rows used (local-customization.js).
(() => {
  if (window.__aimCollection) return;
  window.__aimCollection = true;

  const IMG = (weapon, id) => `/aim-ui/collection/${weapon}--${id}.webp`;
  // family: skins shown as one tile, the variants as colour swatches
  const WEAPONS = [
    { id: "ghost", label: "Ghost", key: "es-ghost-skin", global: "__aimGhostSkin", fallback: "default", skins: [
      { id: "default", name: "Ghost" },
      { id: "smite-ghost", name: "Smite Ghost" },
    ] },
    { id: "sheriff", label: "Sheriff", key: "es-sheriff-skin", global: "__aimSheriffSkin", fallback: "default", skins: [
      { id: "default", name: "Sheriff" },
      { id: "singularity-sheriff", name: "Singularity Sheriff" },
      { id: "arcane-sheriff", name: "Arcane Sheriff" },
    ] },
    { id: "vandal", label: "Vandal", key: "es-vandal-skin", global: "__aimVandalSkin", fallback: "rgx-vandal-yellow", skins: [
      { id: "default-vandal", name: "Vandal" },
      { id: "champions-vandal", name: "Champions 2021 Vandal" },
      { id: "rgx-vandal-yellow", name: "RGX 11z Pro Vandal", family: "rgx", swatch: "#f2c200", variant: "Yellow" },
      { id: "rgx-vandal-blue", name: "RGX 11z Pro Vandal", family: "rgx", swatch: "#2f7bff", variant: "Blue" },
      { id: "gaia-vandal-orange", name: "Gaia's Vengeance Vandal", family: "gaia", swatch: "#e2551d", variant: "Orange" },
      { id: "gaia-vandal-white", name: "Gaia's Vengeance Vandal", family: "gaia", swatch: "#e9ecf2", variant: "White" },
      { id: "primordium-vandal", name: "Primordium Vandal", family: "primordium", swatch: "#c9a45a", variant: "Base" },
      { id: "primordium-vandal-cobalt", name: "Primordium Vandal", family: "primordium", swatch: "#3e64d8", variant: "Cobalt" },
      { id: "kuronami-vandal-white", name: "Kuronami Vandal" },
    ] },
    { id: "phantom", label: "Phantom", key: "es-phantom-skin", global: "__aimPhantomSkin", fallback: "blastx-phantom", skins: [
      { id: "default", name: "Phantom" },
      { id: "blastx-phantom", name: "BlastX Phantom" },
      { id: "recon-phantom", name: "Recon Phantom", family: "recon", swatch: "#d9cfb4", variant: "Base" },
      { id: "recon-phantom-red", name: "Recon Phantom", family: "recon", swatch: "#b8303a", variant: "Red Camo" },
      { id: "helix-phantom-purple", name: "Helix Phantom" },
    ] },
    { id: "guardian", label: "Guardian", key: "es-guardian-skin", global: "__aimGuardianSkin", fallback: "default", skins: [
      { id: "default", name: "Guardian" },
      { id: "prime-guardian", name: "Prime Guardian" },
    ] },
    { id: "operator", label: "Operator", key: "es-operator-skin", global: "__aimOperatorSkin", fallback: "default", skins: [
      { id: "default", name: "Operator" },
      { id: "araxys-operator", name: "Araxys Operator" },
      { id: "rogue-operator", name: "Rogue Operator" },
    ] },
    { id: "melee", label: "Melee", key: "es-melee-skin", global: "__aimMeleeSkin", fallback: "silkleaf-fan", skins: [
      { id: "default", name: "Tactical Knife" },
      { id: "silkleaf-fan", name: "Silkleaf Fan" },
      { id: "blackmarket-butterfly", name: "Black Market Butterfly Knife" },
      { id: "orange-butterfly", name: "Orange Butterfly Knife" },
      { id: "prime-axe", name: "Prime Axe" },
      { id: "soulstrife", name: "Soulstrife Scythe" },
      { id: "kuronami", name: "Kuronami no Yaiba" },
      { id: "champions-2024-blade", name: "Champions 2024 Blade" },
      { id: "vct-2026-sigil-purple-red", name: "VCT 2026 Sigil", family: "vct-2026-sigil", swatch: "#a72c64", variant: "Purple / Red (CN)" },
      { id: "vct-2026-sigil-green", name: "VCT 2026 Sigil", family: "vct-2026-sigil", swatch: "#87b623", variant: "Green (EMEA)" },
      { id: "half-life-crowbar", name: "Half Life Crowbar" },
      { id: "damascus-karambit", name: "Karambit Damascus Steel" },
    ] },
  ];

  const equipped = (w) => {
    let v = null;
    try { v = localStorage.getItem(w.key); } catch {}
    return w.skins.some((s) => s.id === v) ? v : w.fallback;
  };
  function equip(w, id) {
    try { localStorage.setItem(w.key, id); } catch {}
    window[w.global] = id;
    try { window.__aimPrepareSkinAudio?.(); } catch {}
    dispatchEvent(new CustomEvent("aim-skin-change", { detail: { weapon: w.id, skin: id } }));
  }

  let page = null, tabButton = null, deactivated = null, lastHero = "";
  const WEAPON_KEY = "aim-col-weapon-v1"; // the last weapon looked at, so the page opens where it was left
  const state = { weapon: (() => { try { const v = localStorage.getItem(WEAPON_KEY); return WEAPONS.some((w) => w.id === v) ? v : "vandal"; } catch { return "vandal"; } })(), preview: null };

  // UI review (round 3, ui-routines): the look of the newer Routines page (slanted tabs and buttons, cut tiles), focus you can see,
  // motion that plays once (the page when it opens, the picture when it changes), and the respect of reduced motion. Kept here, not in
  // theme-esports.css, so the shared theme file stays untouched.
  const CSS = `
html[data-aim-local]:not(#es) body .es-col { animation: es-col-in .2s ease-out; }
@keyframes es-col-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes es-col-hero { from { opacity: 0; transform: translateX(14px); } }
html[data-aim-local]:not(#es) body .es-col-hero.is-new { animation: es-col-hero .2s ease-out; }
html[data-aim-local]:not(#es) body .es-col-tabs { gap: 2px; }
html[data-aim-local]:not(#es) body .es-col-tabs button { height: 34px; padding: 0 18px !important; background: transparent !important; color: var(--es-muted, #9aa1ae) !important; clip-path: var(--es-slant) !important; font: 700 13px/1 var(--es-head) !important; font-stretch: 75% !important; letter-spacing: .04em; }
html[data-aim-local]:not(#es) body .es-col-tabs button:hover { background: var(--es-raised, #171b23) !important; color: var(--es-text, #f4f5f7) !important; }
html[data-aim-local]:not(#es) body .es-col-tabs button.is-on { background: var(--es-red, #ff4655) !important; color: #fff !important; }
html[data-aim-local]:not(#es) body .es-col-equip { clip-path: var(--es-slant) !important; font-weight: 800 !important; font-stretch: 75%; letter-spacing: .08em; }
html[data-aim-local]:not(#es) body .es-col-equip.is-equipped { box-shadow: none !important; background: rgba(74,222,128,.12) !important; }
html[data-aim-local]:not(#es) body .es-col-tile { clip-path: var(--es-cut); transition: background-color .15s ease-out; }
html[data-aim-local]:not(#es) body .es-col-tile img { transition: transform .15s ease-out; }
html[data-aim-local]:not(#es) body .es-col-tile:hover img { transform: translateY(-2px) scale(1.03); }
html[data-aim-local]:not(#es) body .es-col-tile span { padding-right: 4px; }
html[data-aim-local]:not(#es) body .es-col-swatches button { width: 32px; height: 32px; }
html[data-aim-local]:not(#es) body .es-col :is(button):active:not(:disabled) { transform: translateY(1px); }
/* focus: the strip scrolls sideways (it clips an outside ring) and the buttons are slanted, so the ring sits inside */
html[data-aim-local]:not(#es) body .es-col :is(.es-col-tabs button, .es-col-tile, .es-col-equip):focus-visible { outline: 2px solid #fff !important; outline-offset: -4px !important; }
html[data-aim-local]:not(#es) body .es-col .es-col-swatches button:focus-visible { outline: 2px solid var(--es-red, #ff4655) !important; outline-offset: 3px !important; }
html[data-aim-local]:not(#es) body .es-col-info b { overflow-wrap: anywhere; }
@media (max-width: 900px) {
  html[data-aim-local]:not(#es) body .es-col { grid-template-columns: minmax(0, 1fr) 260px; }
  html[data-aim-local]:not(#es) body .es-col-info { padding-right: 20px; } html[data-aim-local]:not(#es) body .es-col-info b { font-size: 24px; }
  html[data-aim-local]:not(#es) body .es-col-head, html[data-aim-local]:not(#es) body .es-col-strip { padding-left: 16px; padding-right: 16px; }
  html[data-aim-local]:not(#es) body .es-col-tile { width: 160px; height: 108px; } html[data-aim-local]:not(#es) body .es-col-tile img { height: 62px; }
}
@media (max-height: 700px) {
  html[data-aim-local]:not(#es) body .es-col-head { padding-top: 14px; } html[data-aim-local]:not(#es) body .es-col-head h1 { margin-top: 8px; font-size: 28px; }
  html[data-aim-local]:not(#es) body .es-col-strip { padding-top: 10px; padding-bottom: 12px; } html[data-aim-local]:not(#es) body .es-col-tabs { margin-bottom: 10px; }
  html[data-aim-local]:not(#es) body .es-col-tile { height: 104px; } html[data-aim-local]:not(#es) body .es-col-tile img { height: 60px; }
  html[data-aim-local]:not(#es) body .es-col-equip { height: 40px; margin-top: 14px; }
}
@media (prefers-reduced-motion: reduce) { html[data-aim-local]:not(#es) body :is(.es-col, .es-col-hero.is-new) { animation: none !important; } html[data-aim-local]:not(#es) body .es-col-tile:hover img { transform: none; } }
`;
  function injectCss() {
    if (document.getElementById("aim-collection-css")) return;
    const s = document.createElement("style");
    s.id = "aim-collection-css"; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  // The page's band between the lobby's top bar and its bottom bar (both grow on a narrow window, so they are measured).
  function fit() {
    if (!page) return;
    const nav = document.querySelector(".hall-topnav"), bar = document.querySelector(".hall-bottombar");
    const nr = nav && nav.getBoundingClientRect(), br = bar && bar.getBoundingClientRect();
    const top = (nr && nr.height ? Math.max(0, Math.round(nr.bottom)) : 64) + "px", bottom = Math.max(0, Math.round(innerHeight - (br && br.height ? br.top : innerHeight - 48))) + "px";
    if (page.style.top !== top) page.style.top = top;
    if (page.style.bottom !== bottom) page.style.bottom = bottom;
  }

  function tiles(w) {
    // one tile per family; a family tile shows the equipped or first variant
    const out = [], seen = new Map();
    for (const s of w.skins) {
      if (!s.family) { out.push([s]); continue; }
      if (!seen.has(s.family)) { const group = []; seen.set(s.family, group); out.push(group); }
      seen.get(s.family).push(s);
    }
    return out;
  }

  // A selector that finds the focused control again after the page is drawn anew.
  const focusKey = (el) => (!el || !page || !page.contains(el) ? null : el.dataset.weapon ? `[data-weapon="${el.dataset.weapon}"]` : el.classList.contains("es-col-tile") ? `.es-col-tile[data-skin="${el.dataset.skin}"]`
    : el.dataset.skin ? `.es-col-swatches [data-skin="${el.dataset.skin}"]` : el.classList.contains("es-col-equip") ? ".es-col-equip" : null);
  function render(opts = {}) {
    if (!page) return;
    const row0 = page.querySelector(".es-col-row"), keepLeft = row0 && !opts.weaponChanged ? row0.scrollLeft : 0;
    const want = opts.focus || focusKey(document.activeElement);
    paint();
    fit();
    const row = page.querySelector(".es-col-row");
    if (row) {
      row.scrollLeft = keepLeft;
      // the chosen tile in view (a far-right skin was hidden off the strip when the page opened)
      const on = row.querySelector(".es-col-tile.is-on");
      if (on) {
        const r = row.getBoundingClientRect(), t = on.getBoundingClientRect();
        if (t.left < r.left) row.scrollLeft += t.left - r.left - 12;
        else if (t.right > r.right) row.scrollLeft += t.right - r.right + 12;
      }
    }
    if (want) { const el = page.querySelector(want) || (opts.weaponChanged ? page.querySelector(".es-col-tabs .is-on") : null); if (el && !el.disabled) try { el.focus({ preventScroll: true }); } catch {} }
  }
  function paint() {
    const w = WEAPONS.find((x) => x.id === state.weapon);
    const on = equipped(w);
    const cur = w.skins.find((s) => s.id === state.preview) || w.skins.find((s) => s.id === on);
    state.preview = cur.id;
    const fam = cur.family ? w.skins.filter((s) => s.family === cur.family) : [];
    const isOn = cur.id === on, hero = IMG(w.id, cur.id), heroNew = hero !== lastHero;
    lastHero = hero;
    page.innerHTML = `
      <div class="es-col-head"><span class="es-col-kicker">Collection</span><h1>${w.label}</h1>
        <p>${w.skins.length} skin${w.skins.length === 1 ? "" : "s"} · applied the next time you start a round</p></div>
      <div class="es-col-stage"><img class="es-col-hero${heroNew ? " is-new" : ""}" alt="${cur.name}" src="${hero}" decoding="async"></div>
      <div class="es-col-info">
        <b>${cur.name}</b>
        ${fam.length ? `<small>Variant · ${cur.variant}</small><div class="es-col-swatches" role="radiogroup" aria-label="Variant">${fam.map((s) => `<button type="button" role="radio" aria-checked="${s.id === cur.id}" class="${s.id === cur.id ? "is-on" : ""}" data-skin="${s.id}" title="${s.variant}" style="--sw:${s.swatch}"></button>`).join("")}</div>` : `<small>${isOn ? "Equipped" : "Not equipped"}</small>`}
        <button type="button" class="es-col-equip${isOn ? " is-equipped" : ""}" ${isOn ? "disabled" : ""}>${isOn ? "Equipped" : "Equip"}</button>
      </div>
      <div class="es-col-strip">
        <div class="es-col-tabs" role="tablist">${WEAPONS.map((x) => `<button type="button" role="tab" aria-selected="${x.id === w.id}" class="${x.id === w.id ? "is-on" : ""}" data-weapon="${x.id}">${x.label}</button>`).join("")}</div>
        <div class="es-col-row">${tiles(w).map((group) => {
          const show = group.find((s) => s.id === cur.id) || group.find((s) => s.id === on) || group[0];
          const sel = group.some((s) => s.id === cur.id), eq = group.some((s) => s.id === on);
          const label = group[0].family ? group[0].name : show.name;
          return `<button type="button" class="es-col-tile${sel ? " is-on" : ""}${eq ? " is-eq" : ""}" data-skin="${show.id}" aria-pressed="${sel}" title="${label}${eq ? " (equipped)" : ""}"><img alt="" loading="lazy" decoding="async" src="${IMG(w.id, show.id)}"><span>${label}</span>${group.length > 1 ? `<i>${group.length} variants</i>` : ""}</button>`;
        }).join("")}</div>
      </div>`;
  }

  function onPageClick(e) {
    const t = e.target.closest("button");
    if (!t || !page.contains(t)) return;
    const w = WEAPONS.find((x) => x.id === state.weapon);
    if (t.dataset.weapon) { pickWeapon(t.dataset.weapon); return; }
    if (t.dataset.skin) { state.preview = t.dataset.skin; render(); return; }
    if (t.classList.contains("es-col-equip") && !t.disabled) { equip(w, state.preview); render({ focus: ".es-col-equip" }); }
  }
  function pickWeapon(id) {
    if (!WEAPONS.some((x) => x.id === id)) return;
    const changed = id !== state.weapon;
    state.weapon = id; state.preview = null;
    try { localStorage.setItem(WEAPON_KEY, id); } catch {}
    render({ weaponChanged: changed, focus: `[data-weapon="${id}"]` });
  }
  // Keys: ← / → move along the weapon tabs and along the skin tiles (the picture follows), Home / End jump to the ends.
  function onPageKey(e) {
    const t = e.target;
    if (!t || !page.contains(t) || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) return;
    const list = t.dataset.weapon ? [...page.querySelectorAll(".es-col-tabs button")] : t.classList.contains("es-col-tile") ? [...page.querySelectorAll(".es-col-tile")] : t.closest(".es-col-swatches") ? [...page.querySelectorAll(".es-col-swatches button")] : null;
    if (!list) return;
    e.preventDefault();
    const at = list.indexOf(t), to = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowLeft" ? -1 : 1)));
    if (to === at) return;
    const next = list[to];
    if (next.dataset.weapon) pickWeapon(next.dataset.weapon);
    else { state.preview = next.dataset.skin; render({ focus: next.classList.contains("es-col-tile") ? `.es-col-tile[data-skin="${next.dataset.skin}"]` : `.es-col-swatches [data-skin="${next.dataset.skin}"]` }); }
  }

  function open(weapon) {
    if (weapon) { state.weapon = weapon; state.preview = null; }
    if (page) { render({ weaponChanged: !!weapon }); return; }
    injectCss();
    lastHero = "";
    page = document.createElement("section");
    page.className = "es-col";
    page.setAttribute("aria-label", "Collection");
    page.addEventListener("click", onPageClick);
    page.addEventListener("keydown", onPageKey);
    // a mouse wheel over the skin strip scrolls it sideways (it only had a thin horizontal scrollbar)
    page.addEventListener("wheel", (e) => {
      const row = e.target.closest && e.target.closest(".es-col-row");
      if (!row || Math.abs(e.deltaX) > Math.abs(e.deltaY) || row.scrollWidth <= row.clientWidth) return;
      e.preventDefault(); row.scrollLeft += e.deltaY;
    }, { passive: false });
    document.body.append(page);
    deactivated = [...document.querySelectorAll(".hall-tabs .hall-tab.is-active")].filter((b) => b !== tabButton);
    for (const b of deactivated) b.classList.remove("is-active");
    tabButton?.classList.add("is-active");
    render();
  }
  function close() {
    if (!page) return;
    page.remove(); page = null;
    tabButton?.classList.remove("is-active");
    for (const b of deactivated || []) if (b.isConnected) b.classList.add("is-active");
    deactivated = null;
  }
  window.__aimOpenCollection = open;

  function mountTab() {
    const nav = document.querySelector(".hall-topnav .hall-tabs");
    if (!nav) return;
    if (tabButton && tabButton.isConnected) return;
    const settings = [...nav.querySelectorAll(".hall-tab")].find((b) => /settings/i.test(b.textContent));
    tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = "hall-tab es-col-tab";
    tabButton.textContent = "Collection";
    tabButton.addEventListener("click", (e) => { e.stopPropagation(); page ? close() : open(); });
    nav.insertBefore(tabButton, settings || null);
    // any other tab closes the Collection
    nav.addEventListener("click", (e) => { if (e.target.closest(".hall-tab") && !e.target.closest(".es-col-tab")) close(); }, true);
  }

  // Settings > Visuals: the old skin rows are hidden by theme-esports.css; one line points here.
  function mountNote() {
    const vandal = document.querySelector(".es-vandal-row");
    if (!vandal || document.querySelector(".es-col-note")) return;
    const inLobby = !!vandal.closest(".st-view");
    const note = document.createElement("div");
    note.className = "hall-field es-col-note";
    note.innerHTML = `<span class="hall-field-text"><b>Weapon skins</b><small>${inLobby ? "Skins are chosen in Collection, in the lobby's top bar." : "Skins are chosen in Collection, in the lobby's top bar. Applied the next time you start a round."}</small></span>${inLobby ? '<button type="button" class="es-col-note-open">Open Collection</button>' : ""}`;
    note.querySelector(".es-col-note-open")?.addEventListener("click", () => open());
    vandal.before(note);
  }

  // a round started (or the lobby is gone): close
  function check() {
    mountTab();
    mountNote();
    if (page && (!document.querySelector(".hall-root") || document.querySelector(".al-trainer-shell.al-session-active"))) close();
    if (page) fit(); // the lobby's bars settle after the page opened (and change with the window)
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && page) close(); });
  addEventListener("resize", () => { if (page) fit(); });
  let queued = false;
  window.__aimWatchPage?.(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; check(); }); }, { subtree: true, childList: true });
  check();
})();
