# UI review: Routines, Medals and Collection (ui-routines)

## For players
- The drill gallery in the routine editor now lists every drill (it stopped at 150 of 248), and a search says how many drills match.
- The gallery works with the keyboard: ↓ from the search goes to the cards, the arrow keys move between cards, Enter adds one, Esc closes the gallery and puts you back on "Add a drill". Adding a card no longer throws the keyboard focus away.
- Moving a step up or down, changing its enemy rank or removing it keeps your place on the page.
- A routine can hold 30 drills (was 20). When it is full the gallery says so and the cards can no longer be pressed. The lobby's "+ Routine" button says "Routine full" instead of doing nothing.
- The top bar's Routines tab shows how many drills are in the routine you are building, so a drill added from a lobby card visibly went somewhere.
- Save and Discard stay at the bottom of the screen while you scroll a long routine. Saving says "Saved", lights up the new routine and scrolls to it. A missing name gets its own message and puts you in the name field. Enter in the name field saves.
- Delete asks for a second click (now shown in red, and it resets after 4 seconds), then offers Undo. Discard, Stop routine and removing a step also offer Undo. Editing a routine while another one is half-built offers Undo too, so that draft is not lost.
- Start / Play this step show "Starting <drill>…", and if the drill cannot be found you get a message instead of nothing.
- A saved routine with many drills shows the first 8 and a "Show all" button.
- Medals tab: the table sits in a panel, Edit and Play have their own column, the medal editor puts you in the first box, Enter saves, Esc cancels, and wrong numbers (empty, or bronze above gold) get a message and keep what you typed. "Back to automatic" only shows when the numbers are your own.
- Medal badges are drawn larger everywhere, so the three shapes and pips can be told apart.
- Lobby cards: the medal chip moved into the card's footer line (VALORANT Training) or the picture's bottom-left corner (Target Workshop); it used to cover the NEW tag and the category tag. The "+" moved under the bookmark and rename buttons; it used to sit on top of the enemy-rank arrow.
- Target Workshop thumbnails: a target straight ahead is no longer hidden by the crosshair, and swaying targets get the side-to-side arrow.
- Both pages sit between the lobby's top and bottom bars at every window size (on narrow windows the top bar has two rows and used to be covered).
- Collection: slanted weapon tabs and Equip button, cut tiles (like the rest of the game), the strip keeps its scroll position when you pick a skin (it jumped back to the start), the chosen skin is scrolled into view, the mouse wheel scrolls the strip, ← / → move through tabs, tiles and colour swatches, and it opens on the weapon you looked at last.
- Motion: the pages rise in once when opened, the gallery drops in once, the skin picture slides in when it changes; nothing replays on redraws, and all of it is off with "reduce motion".
- Focus rings are visible on the slanted buttons and gallery cards (they used to be clipped away).

## Technical
- Files: `app/routines.js` (page glue rewritten between `// ---- page glue ----` and `api.openPage`; picker, editor, cards, medals table HTML; a new CSS block at the end of `PAGE_CSS`, "UI review, round 3"; `drawThumb` order; `thumbModel` sway arrow; `decorateCards` chip placement; `markTab`), `app/collection.js` (own CSS block `#aim-collection-css`, `fit`, `showChosen`, focus-keeping `render`, keys, wheel), `tests/test-routines.cjs` (30-step cap, match note, full picker, sway arrow).
- Redraws keep focus through `focusKey()` (data-rt + data-i/code/id/tab/dir), with `view.focusAfter` / `view.focusFallback` for actions that move or disable the control.
- One-shot animation flags (`view.animBody`, `view.picker.anim`, `view.flashId`) are consumed by the next `render()`, so redraws never replay them.
- Undo: `notify(text, { undo })` shows a status line with an Undo button for 8 s. Delete re-inserts the routine at its old index and restores the active state.
- `fit()` sets the page's `top`/`bottom` from `.hall-topnav` / `.hall-bottombar`, but only when they sit at the window's edges (right after a resize the lobby lays itself out again; a second `fit` runs 200 ms later and on every lobby change).
- New localStorage keys: `aim-rt-tab-v1` (last Routines tab), `aim-col-weapon-v1` (last Collection weapon). Existing data is unchanged. `MAX_STEPS` 20 → 30 (older routines load as before).
- `PICK_ALL_MAX` / `PICK_SEARCH_MAX` raised to 600: the full library is drawn (map pictures are lazy `<img>`; Target Workshop canvases are drawn once per card, scenes are cached).
- The result-screen strip (`stripHtml`, `place`, `sync`, `finish`) is untouched (owned by ui-result).

## Verified / not verified
- `node tests/run-all.cjs`: all 14 files pass.
- Checked in the browser pane (dev copy on port 8174 through a local User-Agent proxy) at 800x600, 1024x640, 1280x720, 1366x768, 1536x864 and 2560x1440: create, add 6 drills (picker clicks and keyboard), long names, save, flash, delete with confirm and Undo, Stop and Undo, a 30-step routine and a full draft, medals editor errors, lobby card overlap measured from the DOM (no overlaps left), Collection strip scroll, keys and window fit. Start was pressed once and started the round (toast seen).
- Not verified: a played round finishing (no pointer lock in the pane), and the motion at real frame rate in the Electron window.
- Below 640 px of window height the lobby itself scrolls; the pages then leave a few pixels of lobby visible at the bottom (the lobby's minimum height, not changed).
