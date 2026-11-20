// flyable-option-removed-v1
// Lobby top bar: the left sidebar is hidden by theme-esports.css, and its Quick
// start and items (Favorites, Training Creator, Workshop manual, ...) are shown as
// buttons in the top bar instead. Each button clicks the hidden sidebar item, so
// the game's own handlers (and its links) keep working unchanged.
(() => {
  if (window.__aimLobbyBar) return;
  window.__aimLobbyBar = true;

  const SHORT_LABELS = { favorites: "Favorites", "open-studio": "Creator", "open-studio-guide": "Manual" };
  const GAUGE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 14l4-5"/></svg>';

  const SENS_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>';
  const UPDATE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/></svg>';
  const BACKUP_ICON ='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v12H4z"/><path d="M3 4h18v3H3zM10 11h4"/></svg>';

  // The single game-render meter is owned by frame-meter.js.
  function meterOn() { return window.__aimFrameMeter?.enabled() ?? false; }
  function setMeter(enabled) { window.__aimFrameMeter?.setEnabled(enabled); }
  addEventListener('aim-frame-meter-change', () => {
    for (const button of document.querySelectorAll('.es-bar-fps')) button.classList.toggle('is-on', meterOn());
  });

  const PLAY_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>';

  // ---- Discord account (the same Community Workshop sign-in Publish uses) ----
  const DISCORD_LOGO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M19.3 5.6A16.6 16.6 0 0 0 15.2 4.3l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1A16.6 16.6 0 0 0 4.7 5.6C2.1 9.5 1.4 13.3 1.8 17a16.8 16.8 0 0 0 5 2.6l1.1-1.7c-.6-.2-1.2-.5-1.8-.9l.4-.3a11.9 11.9 0 0 0 11 0l.4.3c-.6.4-1.2.7-1.8.9l1.1 1.7a16.8 16.8 0 0 0 5-2.6c.5-4.3-.7-8.1-2.9-11.4ZM8.7 14.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>';
  const workshopApi = window.__aimDesktop?.workshop;
  let account = { user: null, offline: false };
  let avatarData = null;
  let signinWaiting = false;

  function accountControl() {
    const slot = document.createElement("div");
    slot.className = "es-account-slot";
    if (!workshopApi) return slot;
    if (!account.user) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "es-bar-btn es-account-signin";
      button.title = "Sign in with Discord: your name is shown on drills you publish";
      button.innerHTML = DISCORD_LOGO;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = signinWaiting ? "Waiting…" : "Sign in";
      button.appendChild(labelSpan);
      button.disabled = signinWaiting;
      button.addEventListener("click", async () => {
        if (signinWaiting) return;
        signinWaiting = true;
        rerenderAccount();
        try { await workshopApi.login(); } // finishes in the browser; onAuth reports back
        catch (error) {
          signinWaiting = false;
          rerenderAccount();
          for (const failed of document.querySelectorAll(".es-account-signin")) {
            failed.title = error?.message || "Sign-in failed. Try again.";
          }
        }
      });
      slot.appendChild(button);
      return slot;
    }
    const box = document.createElement("div");
    box.className = "es-account";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "es-account-chip";
    chip.title = account.offline
      ? "Signed in with Discord (workshop not reachable right now)"
      : account.user.moderator ? "Signed in with Discord (moderator)" : "Signed in with Discord";
    chip.setAttribute("aria-haspopup", "true");
    if (avatarData) {
      const img = document.createElement("img");
      img.className = "es-account-avatar";
      img.alt = "";
      img.src = avatarData;
      chip.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "es-account-fallback";
      fallback.textContent = (account.user.name || "?").slice(0, 1).toUpperCase();
      chip.appendChild(fallback);
    }
    const name = document.createElement("span");
    name.className = "es-account-name";
    name.textContent = account.user.name;
    chip.appendChild(name);
    chip.insertAdjacentHTML("beforeend", '<svg class="es-account-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>');
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      box.classList.toggle("is-open");
    });
    const menu = document.createElement("div");
    menu.className = "es-account-menu";
    const who = document.createElement("div");
    who.className = "es-account-who";
    who.textContent = "Signed in with Discord";
    const whoName = document.createElement("b");
    whoName.textContent = account.user.name + (account.user.moderator ? " (moderator)" : "");
    who.appendChild(whoName);
    menu.appendChild(who);
    const signOut = document.createElement("button");
    signOut.type = "button";
    signOut.textContent = "Sign out";
    signOut.addEventListener("click", async (event) => {
      event.stopPropagation();
      try { await workshopApi.logout(); } catch {}
      account = { user: null, offline: false };
      avatarData = null;
      rerenderAccount();
    });
    menu.appendChild(signOut);
    box.append(chip, menu);
    slot.appendChild(box);
    return slot;
  }

  function rerenderAccount() {
    for (const slot of document.querySelectorAll(".es-account-slot")) slot.replaceWith(accountControl());
  }

  async function refreshAccount() {
    if (!workshopApi) return;
    try {
      const result = await workshopApi.status();
      account = { user: result?.user || null, offline: !!result?.offline };
    } catch { account = { user: null, offline: false }; }
    avatarData = null;
    if (account.user?.avatar && workshopApi.avatar) {
      try { avatarData = (await workshopApi.avatar())?.data || null; } catch {}
    }
    rerenderAccount();
  }

  workshopApi?.onAuth?.((result) => {
    signinWaiting = false;
    if (result?.ok) refreshAccount();
    else {
      rerenderAccount();
      for (const failed of document.querySelectorAll(".es-account-signin")) {
        failed.title = result?.message || "Sign-in failed. Try again.";
      }
    }
  });
  document.addEventListener("click", () => {
    for (const open of document.querySelectorAll(".es-account.is-open")) open.classList.remove("is-open");
  });
  refreshAccount();
  function sidebarItems() {
    const rail = document.querySelector(".hall-rail");
    // Items the sidebar itself kept hidden stay hidden (the rail is display:none, so check each item's own display).
    // The workshop guide page was never saved offline, so its link would open a 404.
    return rail
      ? [...rail.querySelectorAll(".hall-rail-item")].filter((item) => getComputedStyle(item).display !== "none" && item.dataset.action !== "open-studio-guide")
      : [];
  }

  function itemKey(item, index) {
    return item.dataset.action || `item-${index}`;
  }

  // The bar sits in the top nav just before the Sens box (.hall-topnav-right, whose
  // other children the site's overrides hide).
  function createBar(topnavRight) {
    const bar = document.createElement("div");
    bar.className = "es-bar";
    topnavRight.before(bar);
    return bar;
  }

  function syncDiscordContact() {
    if (!document.querySelector(".hall-bottombar") || document.querySelector(".es-discord-dock")) return;
    const link = document.createElement("a");
    link.className = "es-discord-panel";
    // discord-server-v1 (14 Nov 2026): the openVaim Discord server (permanent invite) instead of @xwvu's profile.
    link.href = "https://discord.gg/W2RWG392Rm";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "Join the openVaim Discord server to report an issue or share feedback";
    link.setAttribute("aria-label", "Join the openVaim Discord server to report an issue or share feedback");
    link.innerHTML = '<span class="es-discord-panel-head"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 6.5A16 16 0 0 1 9 5l.5 1a12 12 0 0 1 5 0L15 5a16 16 0 0 1 4 1.5c1.4 2.3 2 5.5 1.7 8.5A15 15 0 0 1 16 18l-.8-1.3c.8-.3 1.4-.7 2-1.1-3.4 1.6-7 1.6-10.4 0 .6.4 1.2.8 2 1.1L8 18a15 15 0 0 1-4.7-3C3 12 3.6 8.8 5 6.5Z"/><path d="M8.5 11.5h.01M15.5 11.5h.01" stroke-width="2.8" stroke-linecap="round"/></svg><span>DISCORD SUPPORT</span></span><strong>Report an issue<br>or share feedback</strong><span class="es-discord-panel-action">JOIN THE DISCORD <span aria-hidden="true">↗</span></span>';
    // The panel sits in a dock with an arrow tab on its left edge: the arrow slides the panel
    // off the right edge, leaving only the tab, and the tab brings it back. Remembered.
    const dock = document.createElement("div");
    dock.className = "es-discord-dock";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "es-discord-toggle";
    toggle.innerHTML = '<svg class="es-discord-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M19.3 5.6A16.6 16.6 0 0 0 15.2 4.3l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1A16.6 16.6 0 0 0 4.7 5.6C2.1 9.5 1.4 13.3 1.8 17a16.8 16.8 0 0 0 5 2.6l1.1-1.7c-.6-.2-1.2-.5-1.8-.9l.4-.3a11.9 11.9 0 0 0 11 0l.4.3c-.6.4-1.2.7-1.8.9l1.1 1.7a16.8 16.8 0 0 0 5-2.6c.5-4.3-.7-8.1-2.9-11.4ZM8.7 14.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>'
      + '<svg class="es-discord-toggle-arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
    const setCollapsed = collapsed => {
      dock.classList.toggle("is-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? "Show Discord support" : "Hide Discord support");
      toggle.title = collapsed ? "Show Discord support" : "Hide";
      link.tabIndex = collapsed ? -1 : 0;
    };
    let saved = false;
    // No choice saved yet: small windows (under 1400 px) start with the panel tucked to its tab, where it would
    // otherwise cover the map strip and the sort buttons.
    try { const stored = localStorage.getItem("es-discord-collapsed"); saved = stored === "1" || (stored == null && innerWidth < 1400); } catch {}
    setCollapsed(saved);
    // ui-lobby-v1: while the drill list is scrolled down, an open panel tucks away to its tab (not saved), so it
    // never sits on top of a card's Start button. Back at the top it comes out again; the tab opens it any time.
    let tucked = false, peek = false;
    const setTucked = (value) => {
      if (tucked === value) return;
      tucked = value;
      dock.classList.toggle("is-tucked", value);
      const shownCollapsed = value || dock.classList.contains("is-collapsed");
      toggle.setAttribute("aria-expanded", String(!shownCollapsed));
      toggle.setAttribute("aria-label", shownCollapsed ? "Show Discord support" : "Hide Discord support");
      toggle.title = shownCollapsed ? "Show Discord support" : "Hide";
      link.tabIndex = shownCollapsed ? -1 : 0;
    };
    // ui-integration-v1: generalised from "scrolled down" to "covers something". After a scroll, resize or page change
    // settles (debounced, no frame loop), the panel's spot is sampled with elementsFromPoint; when anything under it
    // is a control (button, link, field, tab, clickable card) or content (text, chart, picture), the panel tucks to
    // its tab on every screen. A click on the tab while tucked shows it anyway until the next page change.
    let checkTimer = 0, checkAgain = false, pageKey = "";
    const interactive = (node) => {
      for (let n = node, i = 0; n && n !== document.body && i < 8; n = n.parentElement, i++) {
        if (n.matches("button, a[href], input, select, textarea, label, summary, canvas, img, svg, video, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [tabindex]:not([tabindex='-1'])")) return true;
        if (getComputedStyle(n).cursor === "pointer") return true;
      }
      return false;
    };
    const hasText = (node) => [...node.childNodes].some((c) => c.nodeType === 3 && c.data.trim());
    function covers() {
      const w = link.offsetWidth, h = link.offsetHeight;
      if (!w || !h) return false;
      // The panel's resting place (the dock is translated while tucked): right 22 px, bottom 76 px, tab on its left.
      const right = innerWidth - 22, bottom = innerHeight - 76, left = right - w, top = bottom - h;
      for (let ix = 0; ix < 4; ix++) for (let iy = 0; iy < 3; iy++) {
        const x = left + 4 + (w - 8) * ix / 3, y = top + 4 + (h - 8) * iy / 2;
        const below = document.elementsFromPoint(x, y).find((el) => !dock.contains(el));
        if (!below || below === document.body || below === document.documentElement) continue;
        if (interactive(below) || hasText(below)) return true;
      }
      return false;
    }
    function checkDock() {
      checkTimer = 0;
      if (checkAgain) { checkAgain = false; scheduleDockCheck(); } // events came in meanwhile: one more check after they settle
      if (!dock.isConnected || dock.classList.contains("is-collapsed") || document.pointerLockElement) return;
      const key = location.pathname + "|" + (document.querySelector(".hall-tabs .hall-tab.is-active, .hall-tabs .hall-tab.active")?.textContent || "");
      if (key !== pageKey) { pageKey = key; peek = false; }
      if (peek) return;
      setTucked(covers());
    }
    // At most one pending check (a busy page that changes all the time cannot postpone it forever), plus one trailing
    // check after the last scroll or change, so the end position of a smooth scroll is always looked at.
    const scheduleDockCheck = () => { if (dock.classList.contains("is-collapsed")) return; if (checkTimer) checkAgain = true; else checkTimer = setTimeout(checkDock, 180); };
    document.addEventListener("scroll", scheduleDockCheck, { capture: true, passive: true });
    addEventListener("resize", scheduleDockCheck, { passive: true });
    dockCheck = scheduleDockCheck;
    toggle.addEventListener("click", () => {
      if (tucked) { peek = true; setTucked(false); return; }
      const collapsed = !dock.classList.contains("is-collapsed");
      setCollapsed(collapsed);
      if (!collapsed) peek = true; // opened on purpose: stays out until the next page change
      try { localStorage.setItem("es-discord-collapsed", collapsed ? "1" : "0"); } catch {}
    });
    dock.append(toggle, link);
    document.body.appendChild(dock);
    checkDock(); // at once: it never shows over the page for a moment before tucking
    scheduleDockCheck();
  }
  let dockCheck = null;

  // Quit tab (desktop app only, 17 Nov 2026): a lobby tab (.hall-tab, same look as the others) right after the "Settings"
  // tab in the top nav's tab row (.hall-topnav .hall-tabs). Vue may re-render the row and drop it, so every sync puts it back
  // after Settings when it is missing or out of place. Asks first, so a stray click does not lose the session.
  let quitTab = null;
  function syncQuitTab() {
    if (!window.__aimDesktop?.quit) return;
    const settings = [...document.querySelectorAll(".hall-topnav .hall-tabs .hall-tab, .hall-tabs .hall-tab")]
      .find((tab) => tab !== quitTab && /^\s*setting/i.test(tab.textContent || ""));
    if (!settings) return;
    if (!quitTab) {
      quitTab = document.createElement("button");
      quitTab.type = "button";
      quitTab.className = "hall-tab es-quit-tab";
      quitTab.title = "Quit the game";
      quitTab.textContent = "Quit";
      quitTab.addEventListener("click", (event) => {
        event.stopPropagation();
        if (window.confirm("Quit openVaim?")) window.__aimDesktop.quit();
      });
    }
    if (settings.nextElementSibling !== quitTab) settings.after(quitTab);
  }

  // ui-lobby-v1: tab row that scrolls sideways when the window is too narrow for every tab (theme-esports.css).
  // The mouse wheel scrolls it sideways, the active tab is kept in view, and a soft edge marks hidden tabs.
  let tabsRow = null, lastActiveTab = null;
  function markTabsOverflow() {
    if (!tabsRow) return;
    const max = tabsRow.scrollWidth - tabsRow.clientWidth;
    tabsRow.classList.toggle("es-tabs-more-left", max > 1 && tabsRow.scrollLeft > 1);
    tabsRow.classList.toggle("es-tabs-more-right", max > 1 && tabsRow.scrollLeft < max - 1);
  }
  function syncTabsRow() {
    const row = document.querySelector(".hall-topnav .hall-tabs");
    if (row && row !== tabsRow) {
      tabsRow = row;
      row.addEventListener("wheel", (event) => {
        if (row.scrollWidth <= row.clientWidth + 1 || event.ctrlKey) return;
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) return;
        event.preventDefault();
        row.scrollLeft += delta;
      }, { passive: false });
      row.addEventListener("scroll", markTabsOverflow, { passive: true });
      lastActiveTab = null;
    }
    if (!tabsRow) return;
    const active = tabsRow.querySelector(".hall-tab.is-active");
    if (active && active !== lastActiveTab) {
      lastActiveTab = active;
      const a = active.offsetLeft, b = a + active.offsetWidth;
      if (a < tabsRow.scrollLeft || b > tabsRow.scrollLeft + tabsRow.clientWidth) tabsRow.scrollLeft = a - (tabsRow.clientWidth - active.offsetWidth) / 2;
    }
    markTabsOverflow();
  }
  addEventListener("resize", () => { lastActiveTab = null; syncTabsRow(); }, { passive: true });

  function syncBar() {

    syncDiscordContact();
    dockCheck?.();
    syncQuitTab();
    syncTabsRow();
    const topnavRight = document.querySelector(".hall-topnav > .hall-topnav-right");
    if (!topnavRight) return;
    const previousElement = topnavRight.previousElementSibling;
    const bar = previousElement && previousElement.classList.contains("es-bar") ? previousElement : createBar(topnavRight);

    // Signature of what the sidebar shows now; rebuild the buttons only when it changes.
    const quickStart = document.querySelector(".hall-rail-quick");
    const items = sidebarItems();
    const signature = [quickStart ? quickStart.querySelector("em")?.textContent || "q" : "", ...items.map((item, index) => itemKey(item, index) + ":" + item.textContent.trim() + ":" + item.classList.contains("is-active"))].join("|");
    if (bar.dataset.sig === signature) return;
    bar.dataset.sig = signature;
    bar.textContent = "";

    items.forEach((item, index) => {
      const key = itemKey(item, index);
      const label = item.textContent.trim();
      const button = document.createElement("button");
      button.type = "button";
      button.className = "es-bar-btn" + (item.classList.contains("is-active") ? " is-on" : "");
      button.title = label;
      const icon = item.querySelector("svg");
      if (icon) button.appendChild(icon.cloneNode(true));
      const labelSpan = document.createElement("span");
      labelSpan.textContent = SHORT_LABELS[key] || label;
      button.appendChild(labelSpan);
      button.addEventListener("click", () => {
        // Creator opens the Studio (studio/), which replaces the site's editor.
        if (key === "open-studio") return location.assign("/studio/");
        const liveItem = sidebarItems().find((candidate, candidateIndex) => itemKey(candidate, candidateIndex) === key);
        if (liveItem) liveItem.click();
      });
      bar.appendChild(button);
    });

    // The FPS counter is set in Settings > Performance counter (Off / On / On + details).

    // The agent (Jett / Neon) is picked in game now: press N in a round (agent-picker.js).

    // Panels from player-tools.js.
    for (const [label, title, icon, toolMethod] of [
      ["Sens tools", "Sensitivity tools: eDPI, cm/360 and converter from other games", SENS_ICON, "openSens"],
      ["Backups", "Back up, restore, export or import your training data", BACKUP_ICON, "openBackups"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "es-bar-btn";
      button.title = title;
      button.innerHTML = icon;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      button.appendChild(labelSpan);
      button.addEventListener("click", () => window.__aimTools?.[toolMethod]());
      bar.appendChild(button);
    }

    // Stats (analytics-ui.js) is page content on the Training history tab since 17 Nov 2026, not a top-bar button.

    // Check for updates (release-updates-ui.js), in the installed and portable apps.
    if (window.__aimDesktop?.updates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "es-bar-btn es-bar-updates";
      button.title = "Check for updates";
      button.innerHTML = UPDATE_ICON;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = "Updates";
      button.appendChild(labelSpan);
      button.addEventListener("click", () => window.__aimReleaseUpdates?.open());
      bar.appendChild(button);
    }

    bar.appendChild(accountControl());

    // quick-start-removed-v1 (user, 14 Nov 2026): no Quick start button in the top bar.
    if (false && quickStart) {
      const quickStartName = quickStart.querySelector("em")?.textContent.trim() || "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "es-bar-quick";
      button.title = quickStartName ? `Quick start: ${quickStartName}` : "Quick start";
      button.innerHTML = PLAY_ICON;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = "Quick start";
      button.appendChild(labelSpan);
      button.addEventListener("click", () => document.querySelector(".hall-rail-quick")?.click());
      bar.appendChild(button);
    }
  }

  // Use native wheel scrolling and the active tab fill for direct feedback.

  let syncQueued = false;
  // Only page changes that touch the lobby bar, sidebar or bottom bar matter. The results screen
  // animates every frame (score count-up, chart); without this filter each frame ran syncBar(),
  // whose getComputedStyle forces a full style recalculation (65-180 ms UI freezes after a round).
  const BAR_PARTS = ".hall-rail, .hall-topnav, .hall-bottombar";
  const touchesBar = (node) => node && node.nodeType === 1 && (node === document.body || node === document.documentElement || node.closest?.(BAR_PARTS) || node.matches?.(BAR_PARTS) || node.querySelector?.(BAR_PARTS));
  const relevant = (records) => !records.length || records.some((r) => touchesBar(r.target.nodeType === 1 ? r.target : r.target.parentElement) && (r.type !== "childList" || r.target.closest?.(BAR_PARTS) || [...r.addedNodes, ...r.removedNodes].some(touchesBar)));
  window.__aimWatchPage((records) => {
    if (!relevant(records)) return;
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      // syncBar() forces a full style recalculation (130+ ms in a round) and the bar is hidden
      // then. The training class leaving the body wakes this watcher to catch up.
      if (document.body.classList.contains("al-training-active")) return;
      syncBar();
    });
  }, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  syncBar();
})();
