# ui-settings: Settings page, tool dialogs, updates, VALORANT import, offline Community Workshop

## For players

- **The Interface choice (Enhanced or Performance) is back** under Settings > Video > Smoothness. It had gone missing, so anyone who picked Performance could not switch back. The settings search now finds it too ("performance", "blur", "interface").
- The Discord support panel no longer covers the switches and slider values on the Settings page (it still shows on every other tab).
- Long setting descriptions wrap onto a second line instead of being cut off with "..." on smaller windows.
- Controls tab: the intro line has its missing spaces back ("wheel up/down can be bound", "to cancel. Each key").
- Clearer wording: "Keep player centered", "Vision cones", "Show map region names", "Show inner lines", "Wall spray", a plainer pre-aim note under the minimap, a clearer Kill icons hint, and the Audio note now points to Collection for weapon skins.
- Audio tab section titles (Master, Hit, Kill) look like the section titles on the other tabs.
- Small windows: the Settings categories no longer overlap the "Changes save automatically" note; the list scrolls instead. On short windows the pinned crosshair preview is shorter, so more settings fit.
- Backups and Sensitivity tools: keyboard focus moves into the panel, Tab stays inside, and Esc returns you to the button you came from. In Sensitivity tools the confirmation ("Trainer sensitivity set to ...") appears right under the button you pressed, and the DPI box is ready to type in.
- Dialogs open with a quicker, calmer animation, have a solid background in Performance mode, and skip the animation when Windows asks for reduced motion.
- Updates: errors show in red (they showed in green), the "latest version" message names your version, and the update notice sits at the top right (it covered the Discord panel at the bottom) with a close button.
- Settings: the "Import from VALORANT" button fits on one line in the side bar.
- Community Workshop without internet: instead of "Nothing here yet ... Yours could be the first", it says the workshop can't be reached and offers **Try again**.

## Technical

Files: `app/interface-mode.js`, `app/player-tools.js`, `app/release-updates-ui.js`, `app/release-updates.css`, `app/valorant-import-ui.js`, `app/valorant-import.css`, `app/community-workshop.js`, `app/community-feed.js`, `app/main.js` (2 lines), `app/theme-esports.css` (the player-tools block, plus a new block `ui-settings-review-v1` at the end), `tools/patch-settings-wording.cjs` (new), `app/site/**/Dc2Dm9E6.js` (by that script), `tests/test-community-feed.cjs` (new).

- Interface row: the game renamed the Smoothness row's `data-setting` from `frameMode` to `frameRate`; `interface-mode.js` anchors on either. It also sets `html.es-on-settings` while `.hall-body > .st-view` exists (used to hide `.es-discord-dock`), and gives its row `data-focus="esUiMode"`.
- `tools/patch-settings-wording.cjs`: marker `aim-settings-wording-N`, 9 edits in `Dc2Dm9E6.js` (both copies), anchors checked to occur once, safe to rerun. Edit 7 adds one settings-search entry `{id:'esUiMode', tab:'video', section:'Smoothness', ...}` before the `lowLatency` entry. **Merge note:** the bundle is a few very long lines, so another branch that patched `Dc2Dm9E6.js` will conflict textually; resolve by taking the other side and running this script again.
- Offline workshop: `loadCommunityCards()` returns `Object.assign([], {offline: true})` when page 1 of the service could not be read; `community-feed.js` `home()`/`page()` add `offline` to their data. `community-workshop.js` (`workshop-offline-v1`) reads `/pw/items/home`, toggles `html.es-workshop-offline` (CSS hides the page's `.pw-empty` and the lone count) and inserts `.es-offline-note` beside the empty block (Vue's own nodes are not changed). Try again = `api.refresh()` + `__aimPwReload()`.
- Tool dialogs: `showPanel()` now has aria-modal, a labelled title, a focus trap and focus return; `placeStatus()` moves the status line under the action used.
- Release/import CSS: hex colours replaced by the theme tokens; entrance animation 0.2 s ease-out (`es-tool-in` no longer scales/overshoots).

## Checked / not checked

- Checked in the browser pane (dev copy on port 8176 behind a UA proxy) at 1024x640, 1280x720, 1536x864 and 2560x1440: every Settings tab, the search and its Go button, Backups and Sensitivity tools (fake backups API), the update panel and notice (fake updates API, including an error), the VALORANT import dialog (fake API), the agent picker (opened with a fake pause screen), the offline Community Workshop (the local workshop service was not running, a real offline case). `node tests/run-all.cjs` green (15 files).
- Not checked: the real desktop APIs (actual backup/restore, an actual update download, a real VALORANT file import), an online workshop catalog, the enemy-rank badges (no drills in the test page), anything inside a live round.
- Left as is on purpose: Settings stays full width at 2560 px (a user decision noted in theme-esports.css, 2026-11-11), so rows are very wide there.
- Top-bar problems at 1024 and 1280 px (hidden tabs, two-line nav, Sens box off-screen) were reported to ui-lobby, who fixed them in their branch.
