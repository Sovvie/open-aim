# QA review of v1.6.0-dev (workstream "qa")

Reviewed `git diff v1.5.0..v1.6.0-dev` at commit 0896454. Branch `ws/qa`. No product defects were found that needed a code fix; one test was added.

## Plain summary
- Nothing found that blocks the release. All 13 test files pass.
- The 30 `valorant-*` and 44 `workshop-*` drills appear where they should, with names, descriptions and thumbnails, and every one is in the Routines picker.
- `npm run build` in `app/` regenerates `app/training-set.json` (the `prebuild` script), so the installed app will contain the new drills. Only a direct `electron-builder` call would skip it.

## Fixed / added
- Added `tests/test-segment-box.cjs`: runs the 1.5.0 `segmentBox` (copied verbatim) against the 1.6.0 one in `app/analytics-recorder.js` on 200,000 random segments and boxes (four value scales, plus NaN and infinite inputs) and requires `Object.is`-equal `dist` and `t`. Result: bit-identical.

## Checked, no defect
- `app/main.js` big-file streaming (`streamBigFile`): GET returns exactly the file bytes (`cmp` against the 76 MB `ascent.glb`), HEAD returns the same headers and no body, `Content-Length` is correct, a `Range` request gets the full 200 as it did in 1.5.0 (the server never supported ranges, no `Accept-Ranges` is sent), clients that abort mid-transfer leave the server serving normally (`pipeline` destroys the file stream), files under 1 MB take the old path. `site_meta.json` headers are only `Cross-Origin-Resource-Policy`, so spreading them is safe. HTML pages (themed `/aim`) are far below 1 MB so they never skip the theming step; this would only matter if a themed HTML file ever reached 1 MB.
- `no-proxy-server`: set before `app.whenReady`. The updater (`release-updates.js`), workshop calls and the Discord avatar fetch all use Node's global `fetch`, which never used Chromium's proxy settings, so nothing that worked before is affected. No `net.request`/`session.fetch` is used anywhere.
- `AIM_STARTUP_TRACE` code is inert unless the variable is set (`trace(...) || setTimeout(...)` still reaches `setTimeout` because `trace` returns undefined).
- `tools/patch-tracking-no-fire.cjs`: second run reports "nothing to do" for all four bundles.
- Generators: tests confirm the committed `valorant-*` and `workshop-*` files equal generator output; each deletes stale files only with its own prefix.
- `analytics-ui.js` new Session/Drills/Compare/export code and `coach.js` session shape: read through; field names match what the recorder stores (`end`, `killTick`, `startTick`); CSV cells guard against formula injection; all inputs are guarded for missing data. Rule ids `warmup` and `fade` have a short summary and an icon.
- `sibling-switch.js` ball-drill fallback: looks for the card in VALORANT Training for 2.5 s, then opens Target Workshop and uses `.tw-card[data-code]`; selectors match the Target Workshop markup.
- `app/studio/**`: new keyboard handler stays behind the existing editor-only guard; import validates place, bot types and sizes.

## Smoke test (dev copy of ws/qa on port 8165, window moved to monitor 2, closed afterwards)
Pages were loaded in the built-in browser pane through a small local proxy that presents a normal-browser User-Agent (the pane's own User-Agent contains "Electron" and so does not get the injected UI scripts) and replaces `requestAnimationFrame` (it never fires in the hidden pane, which stops Routines and Collection from mounting their tabs). Neither is an app bug.
- Tabs visited: VALORANT Training, Target Workshop, Community Workshop, Training history, Routines (new-routine picker), Collection, Settings. Console and `window.onerror`: no errors. One warning, "Multiple instances of Three.js being imported", on Settings (game bundle, present before 1.6.0).
- VALORANT Training: 134 cards, all 30 new drill codes present with the right names; 26 listed under Angle holding and 4 under Anti-flash (filter chips: Pre-aim 87, Angle holding 40, Anti-flash 6, Scenarios 1). Cover images return 200 for all eight maps used.
- Target Workshop: 53 cards (44 new + 9), all 44 present, with name, description, category tag and a drawn preview canvas that is not blank; chips Flicking 24, Tracking 11, Reaction 4, Moving 14 add up to 53.
- Routines picker: "All drills 187"; searching each of the 74 names finds it.
- Collection page renders.

## Theme check
- New CSS added to `analytics-ui.js` and `studio.css` has no rounded corners (`border-radius:0` and slanted clip-paths in the lobby, same as before in the Studio), reuses the `--an-*` tokens and the red accent, uppercase condensed headings.
- Lobby cards, Routines page and Collection look consistent with the esports theme in screenshots.
- Off, minor: with the Routines page open the Target Workshop tab showed a dark-red fill next to the red Routines tab (could be hover left over from earlier clicks; its class list at that moment was not checked). Studio keeps its own flat look and `.stat span` still has the old 999px pill radius (not new).

## Not fixed (all low)
- Release housekeeping: `app/package.json` still says version 1.5.0 (`CHANGELOG.md` has the section as "Unreleased"). Bump it when the release is cut, or the in-app updater will compare against 1.5.0.
- Studio paste: clipboard items without an `id` would all get one new id (items made by Copy always have ids, so only a hand-written clip hits this).
- Studio paste falls back to the last internally copied clip when the system clipboard holds unrelated text; pressing Ctrl+V after copying a URL pastes the old clip. Probably intended ("else what Ctrl+C kept").
- A full `electron-builder` run was not done (per brief). Checked by reading: `files` covers `*.js`, `*.cjs`, `studio/**/*`, `training-set.json`; `base`, `site` and `site_meta.json` go in as extraResources.

## Could not verify
- Real rounds (no pointer lock in the pane): tracking-drill scoring patch, new drills' bot behaviour, the Stats tabs with real recorded data (covered by `tests/test-analytics-views.cjs`, not seen on screen with data), the CSV/JSON save dialog in Electron, Studio editing, a packaged build.
