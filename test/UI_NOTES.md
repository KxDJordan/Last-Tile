# UI notes (shell.html, style.css, ui.js, main.js)

## What is built
- **Loadout**: 3D pedestal (`VIEW.pedestal`) with swipe and arrow class switching, class name, role, passive, 3 variant buttons, and a bottom sheet with Stats, Gamebreaker, Deck and Presets tabs (sliding ink, error badges on the tabs). Everything is live from `DATA.statsFromPoints`, `card.text(stats)`, `card.key(stats)` and `DATA.validateDeck`/`validateLoadout`. The Play button shows `errors[0]`. Changing class resets the deck to `DATA.starterDeck`. The default loadout is Vanguard/Bastion, HP4 ATK2 DEF2 SPD2, first Gamebreaker, starter deck. The last played loadout and 4 named presets are kept in localStorage, with try/catch around every access.
- **Match HUD**: top bar (round, ring countdown that pulses magenta when 1 round away, players alive, 2× toggle, menu) and a turn strip in SPD order (`VIEW.portrait`, active and eliminated states, mini HP bars). Below that: a fanned hand of TCG cards (cost gem that turns green or red when `cardCost` differs, category band and icon, big key number, class corner, dimmed via `canPlay`), HP and shield bar, energy pips, a circular Gamebreaker meter button, End Turn (glows when nothing is left to do), Move, banners, a 3-line combat log that expands, a detail panel, and the cache modal (the shard option opens a stat picker).
- **Human controller** (`UI.createHumanController()`): the full targeting flow (tap a card, see targets, tap a tile to preview the area, then tap again or Confirm), cards with pickCount 0 going straight to confirm, any number of picks (Grand Swap), the Gamebreaker using the same flow, free walking: with no card selected, `walkTargets` tiles are softly highlighted whenever `moveLeft > 0`; tapping one previews the walk (cost from `walkCost`, movement left afterwards) and tapping again or pressing Confirm runs `doMove`. Walking never ends the turn, and the highlights refresh afterwards. The Move button toggles the same mode explicitly. Selecting a card switches to its targets, and Cancel returns to the walk highlights. input locked while `playCard`/`useGb`/`doMove` run, Esc/Enter on desktop, and read-only card inspection when it is not your turn.
- **End screen**: "Victory" or "Eliminated — Nth", 4 stats, full standings, Play Again and Back to Loadout. An early elimination brings up a sheet offering Spectate (2×, with a live chip and Leave) or Leave. The menu also has Leave match.
- **main.js**: builds 8 loadouts (the human plus 7 from `DATA.randomLoadout`, keeping their names), the composite view (each CONTRACT method calls `VIEW[m]` and then `UI.hooks[m]`; missing methods and rejections are tolerated), the controllers (human plus `AI.createController({delay:400})`) and the game, then calls `game.run()`. It handles `prefers-reduced-motion` (CSS class plus `VIEW.setReducedMotion`) and calls `VIEW.setInsets` with the measured HUD heights on resize, orientation change and a ResizeObserver.

## Contract assumptions
- `view.init` runs once per game. The composite also runs init lazily before any other view call in case CORE never calls it, and a second call is a no-op.
- The game is constructed with an empty proxy view; the composite methods are copied onto it afterwards (CORE fills in stub methods, then they are overwritten).
- Card `uid`s can be numbers. The UI matches them through `String(uid)` and passes the original value back to CORE.
- After `VIEW.stop()` (back on loadout) main calls the optional `VIEW.start()` before the next match. `VIEW.mount` is called only once.
- The pedestal canvas is recreated each time the loadout opens; the old pedestal is `dispose()`d when a match starts.
- Leaving a running match bumps a match token: the old game's view calls resolve on `setTimeout(0)` and its human controller returns at once (it compares `game !== current game`), so it finishes quickly in the background.
- CORE sends the 'Your turn' banner, so the UI adds none of its own. Identical banners within 1.5s are deduped.
- `doMove`/`playCard`/`useGb` resolving `false` shows a toast and keeps the turn. End Turn is the only way to end a turn.
- Movement HUD: `p.moveLeft`/`p.moveMax` appear as a cyan segmented step bar ("→ 3/4") next to the energy gems, which are now violet to match the card cost gem, and as a count on the Move button. The 2-tap confirm plus VIEW's 8px tap threshold keep camera drags from walking.
- Loadout SPD row: labelled "Walk" with the resulting value. It uses a short local description ("Tiles walked per turn") so it fits on 2 lines; other stats use `DATA.STAT_INFO`.
- The cache modal is independent of turn state, so it also works when the human is pushed, pulled or swapped onto a cache during someone else's turn.
- After the last ring closes (`nextRingIn === null`), the ring pill counts down `game.nextSurgeIn` ("Sudden death in N", then "Surge in N"), styled magenta. The end screen shows `rounds` and "Time up" when `endedByCap`.
- Stat names and descriptions come from `DATA.STAT_INFO` when present. Temp hand cards (`blitz_step`) get a "Temp" tag.

## Gaps or notes for the other modules
- VIEW: the pedestal camera frames the piece edge to edge, so tall plumes touch the top of the canvas. A little headroom would help.
- VIEW: `highlight()` gets the category color as `color`; walk tiles at idle use `#9fe8ff`.
- Under SwiftShader the real 3D scene renders at about 2.5 fps. `backdrop-filter` layers being removed stalled Chromium screenshots there, so the UI uses no backdrop-filter, which also helps on phones.

## Tests (all in test/)
- `build-dev.js`: mocks plus whichever real modules exist. `MOCK=core,ai,view` forces mocks. `ui-mocks.js` has a minimal DATA, a fake CORE/AI and a 2D canvas VIEW stub.
- `shoot-loadout.js`, `shoot-match.js`, `shoot-modals.js`, `shoot-misc.js`: screenshots plus checks for touch targets and console errors.
- `ui-functional.js`: 14 loadout logic checks (presets, swipe, deck rules, Play reason, class reset, storage that throws).
- `play-through.js`: a whole real match (end turn until eliminated, Spectate, end screen, Play Again, Leave via the menu, back to loadout).
- Screenshots are in `test/shots/ui/`.
