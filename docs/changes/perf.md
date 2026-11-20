# Performance workstream (perf), openVaim 1.6.0

## For players (plain words)

- The first window opens about 1 second sooner (about 1.6 s down to about 0.6 s on the test PC, from starting the program).
- Loading a map no longer holds a whole copy of the map file in memory at once (saves about 130 MB of temporary memory per map load and a 40-50 ms stall).
- The Stats recorder does about 20-28 % less work per game tick when shots are being fired.
- Nothing looks or behaves differently.

## Measurements

All numbers are medians on one Windows 11 PC, dev copy (`electron .` from source), warm disk cache. Timings are ms since process start. "Before" is commit 49431e6 plus timing code only.

| Measure | Before | After |
| --- | --- | --- |
| Window shown (median of 5) | 1588 | 625 |
| Page DOM ready | 1569 | 606 |
| UI scripts finished | 1667 | 712 |
| Serving a 92 MB map file: event-loop stall | 44-50 ms | 10 ms |
| Same: peak process memory (benchmark) | 246 MB | 130 MB |
| Same: download time | about 155 ms | about 140 ms |
| Recorder per tick, 8 enemies (shots at 10/s) | 9.4 us | 7.4 us |
| Recorder per tick, 20 enemies | 30.2 us | 21.7 us |

### Where the second went

Chromium waited about 1.34 s between `loadURL` and its first request to the local server, even in an empty Electron app (`mini` probe, not committed). With `--no-proxy-server` that wait is 0.35 s. It is the Windows proxy auto-detect lookup. The game only talks to this PC: every other address is blocked in `onBeforeRequest`, and the updater and workshop use Node's `fetch`, which never used Chromium's proxy. So the switch changes no behaviour.

### Things measured and left alone (not worth it)

- Lobby idle cost (CDP `Performance.getMetrics`, 20 s): 0.28 ms of script per second (0.03 % of one core), no layout, no style recalcs, 11 MB JS heap, about 1300 DOM nodes. The intervals in frame-meter (250 ms), shooting-error (500 ms) and brand-name (1 s) and the MutationObservers are all negligible.
- Frame meter `snapshot` every 250 ms at 240 FPS: 0.1 ms per call, 0.4 ms per second.
- Recorder remaining cost is mostly `segmentBox` (shots) and `trackTick`; at 8 enemies it is under 1 ms per second of play.
- IndexedDB writes are already queued per round, not per tick.
- `main.js` load plus all synchronous UI-script reads: 14 ms. Nothing to defer.
- Two raw MutationObservers (`release-updates-ui.js`, `valorant-import-ui.js`) do not sleep during rounds like the `__aimWatchPage` ones. Their callback is tiny, so I did not touch them (a change needs catch-up on unlock, for no measurable gain).
- "Performance" summary in the FPS meter: skipped, the meter already shows FPS, frame time, 1 % low and worst.

## Package size (installer 1,160 MB, content 1.42 GB)

- Composition of `app/site` (1.3 GB): `.glb` maps 659 MB (already meshopt plus Basis textures, brotli only gains 18 %), `.png` 386 MB (lightmaps and skin textures, not compressible by the installer), `.bin` 140 MB (compresses to about 14 %), audio 57 MB.
- The installer is already 82 % of the raw size, so the installer's LZMA is doing its job on the compressible part. `compression: maximum` (64 MB dictionary, preset 9) measured 10.8 MB vs 12.0 MB on 77 MB of `.bin`, about 10 % of an already small part, about 1 MB overall for a slower build. Not changed.
- True duplicate files (md5): 110 groups, 36.7 MB (mostly weapon skin variants and the `next` / `_assets/r20261021-1` JS copies). The installer's solid LZMA already folds those that sit near each other, so serving them by alias from `main.js` would save very little in the installer and add risk. Not done.
- Lossless PNG recompression is the one real saving: `python tools/optimize-png.py` (dry run by default, Pillow). Dry run on the real tree: 190 files smaller, 84 left alone, **384.7 MB to 316.6 MB, saves 68.1 MB (17.7 % of the PNGs, about 6 % of the installer)**. Each output is kept only if every pixel and the mode are identical and the source has no colour-management chunk. It is NOT applied in this branch, because the files are tracked in git and rewriting them adds about 317 MB of new blobs to a public repo. Decide whether to run `--write` once on a release branch. A better optimiser (oxipng or zopfli) would likely save more; none was installed here.
- I did not run `npm run build`, so the installer size after the PNG change is an estimate (PNG bytes are incompressible, so the installer should shrink by about the same 68 MB).

## Technical

- `app/main.js`
  - `app.commandLine.appendSwitch("no-proxy-server")` (marker `no-proxy-server-v1`).
  - `streamBigFile()` (marker `big-files-streamed-v1`): files of 1 MB or more served from `app/site` and from `base/` are piped from `fs.createReadStream` (1 MB chunks) with the same status and headers (`Content-Length` set from `statSync`, HEAD sends headers only). Smaller files still use `readFileSync`. Verified against the running server earlier: md5 of the 92 MB map, a 7.6 MB PNG and a 6 MB `.bin` equal the files on disk; HEAD correct; a client aborting mid-download does not break the server.
  - `AIM_STARTUP_TRACE=1` prints `STARTUP +ms label` lines (main loaded, app ready, server listening, did-start-loading, dom-ready, ready-to-show, window shown, ui scripts done, did-finish-load, renderer paint timing) and one line per HTTP request. Off by default; costs nothing when off.
- `app/analytics-recorder.js`: `segmentBox` evaluates the point-to-box distance inline instead of building an array per evaluation (120 per search). Same arithmetic in the same order, so results are bit-identical; `tests/test-analytics-idb.cjs` passes (70 tests); `node tests/run-all.cjs` all 8 files pass.
- `tools/optimize-png.py`: described above.

## Method

- Startup: a script launched `electron app --port=<n>` five times with `AIM_STARTUP_TRACE=1`, killed it after the marks arrived, took the median.
- Idle cost: Electron started with `--remote-debugging-port`, CDP `Performance.getMetrics` read 8 s after launch and again 20 s later.
- Recorder: the real `analytics-recorder.js` loaded in Node with `tests/fake-idb.cjs`, 40 000 synthetic ticks (moving enemies, a shot every 12 ticks) fed in batches of 32, median of 5 runs after warm-up.
- Serving: a plain Node HTTP server sending a 92 MB map with each method, 5 downloads, event-loop lag sampled every 5 ms.

## Not verified

- No live round was played. The streamed-file change was checked over HTTP against the real server, not with a map loading in a round.
- Startup numbers are from a dev copy on one PC; an installed build also has the NSIS/portable unpack step. Machines with no proxy auto-detect delay will gain less than 1 s.
- The user's rule came in mid-task: no app window is left open, and no further launches were made after it.
