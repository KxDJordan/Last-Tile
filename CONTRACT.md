# LAST TILE: module contract

The full game spec is in `BRIEF.md`; read it. This file pins down the interfaces between modules so the Systems, Graphics and UI work can run in parallel. **Don't change a signature here without saying so in your final report.** You may add optional extras.

## Files and ownership

| File | Owner | Defines global |
|---|---|---|
| `src/data.js` | Systems | `DATA` |
| `src/core.js` | Systems | `CORE` (with `CORE.Game` and `CORE.stubView()`) |
| `src/ai.js` | Systems | `AI` (with `AI.createController(opts)`) |
| `test/headless.js` | Systems | node script: 200+ 8-bot matches |
| `src/view.js` | Graphics | `VIEW` |
| `test/view-sandbox.html` | Graphics | optional dev page |
| `src/shell.html` | UI | page skeleton with `/*__STYLE__*/` and `/*__SCRIPTS__*/` markers |
| `src/style.css` | UI | all CSS |
| `src/ui.js` | UI | `UI` |
| `src/main.js` | UI | bootstrap (wires DATA, CORE, AI, VIEW and UI) |

`node build.js` concatenates the files in the order data, core, ai, view, ui and main, places them in one inline `<script>` inside `shell.html`, inlines the CSS and writes `dist/last-tile.html`. Each file must be a plain script with **no import/export**. It declares exactly one top-level `var NAME = (function(){ ... return {...}; })();`. Files share one global scope, so keep all other names inside the IIFE.

`data.js`, `core.js` and `ai.js` must never reference `window`, `document`, `THREE` or `localStorage`. They are loaded in node through `vm` (see `test/load-core.js`).

Three.js r128 is loaded from cdnjs as `THREE`. **In this sandbox the CDN is blocked.** For browser tests, use `test/browser.js`, which routes the CDN URL to `node_modules/three/build/three.min.js`. r128 does NOT include OrbitControls, EffectComposer or CapsuleGeometry.

Fonts: display font **"Cinzel"** (weights 600 and 800) for titles and numbers, with fallback `Georgia, 'Times New Roman', serif`. UI font **"Inter"** (weights 400, 600 and 800), with fallback `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.

## Shared constants (in DATA)

```js
DATA.CLASS_IDS = ['vanguard','striker','marksman','phantom','lifebinder','hexer']
DATA.CLASSES[id] = { id, name, role, color:'#hex', color2:'#hex' /*accent*/, passiveName, passiveText,
                     starterDupes:[cardId,cardId], idealRange, variants:[{id,name,desc}x3], gamebreakers:[gbId x3] }
DATA.CATEGORIES = { movement:{name:'Movement',color:'#38d6ff',icon:'➜'}, damage:{name:'Damage',color:'#ff4d5e',icon:'⚔'},
                    utility:{name:'Utility',color:'#ffc94d',icon:'✦'}, recovery:{name:'Recovery',color:'#4dff9a',icon:'✚'} }
DATA.TEAM_COLORS = 8 distinct hex strings; index 0 is the human player.
DATA.CARDS[id] = { id, name, cls:'general'|classId, cat, cost, pickCount, text(stats)->string, key(stats)->string /*short number for the card face, e.g. "7" or "+6"*/,
                   targets(game,user,picks)->[{x,y}], area(game,user,picks)->[{x,y}], apply(game,user,picks)->Promise, ai?:{...} }
DATA.GAMEBREAKERS[id] = { id, cls, name, cost, pickCount, text(stats), targets, area, apply }
DATA.statsFromPoints(points /*{hp,atk,def,spd}*/, shards? /*{hp,atk,def,spd}*/) -> { maxHp, atk, def, spd, hpPts }
DATA.validateLoadout(loadout) -> { ok:boolean, errors:[string] }   // errors[0] is the Play-button reason, e.g. "Spend 3 more points" or "Deck needs 1 more Recovery card"
DATA.validateDeck(clsId, deckIds) -> { ok, errors:[string], counts:{class, general, movement, damage, utility, recovery} }
DATA.starterDeck(clsId) -> [cardId x16]
DATA.cardPool(clsId) -> [cardId]   // class cards and general cards
DATA.randomLoadout(rng, clsId?) -> loadout  // valid random loadout for bots
```

`pickCount` is the number of tile picks needed. 0 means self-targeted: go straight to confirm. Most cards use 1. Grand Swap uses 2. Walk-type cards use 1: the pick is the destination, and CORE computes the path.

A loadout looks like: `{ name, cls, variant, points:{hp,atk,def,spd}, gb, deck:[16 ids], isHuman }`.

## CORE

```js
const game = new CORE.Game({ loadouts:[8 loadouts], seed, view, controllers:[8 controllers], humanIndex /*-1 for none*/ })
await game.run()   // resolves with results when one piece is left (or a round cap is hit as a safety net)
```

### State the view and UI read (treat it as read-only)

- `game.size` is 12. `game.tiles[y][x]` is `{x, y, h /*0-3*/, ring, corrupted, warning, pillar, cache /*null|{}*/, trap /*null|{ownerId,kind}*/, marked /*bool, Skyfall*/}`. `game.tile(x,y)` returns `null` when out of bounds.
- `game.players[]`: each `p` has `{ id /*0-7*/, index, name, cls, variant, colorIndex, color, isHuman, x, y, hp, maxHp, shield, energy, maxEnergy, hand:[{uid,id,temp}], deck:[...], discard:[...], meter, gb, gbUsedThisTurn, alive, place, statuses:[{type,turns,...}], invisible, stance /*null|'move'|'act'*/, movedThisTurn, stats:{dmgDealt,kills,caches,gbUsed} }`
- `game.stats(p)` returns effective `{maxHp, atk, def, spd, hpPts}`, including shards and buffs. This is what card `text()` takes.
- `game.entities` is the players plus decoys. A decoy is `{ id:'d…', isDecoy:true, ownerId, x, y, alive }`; it shows its owner's hp and model.
- `game.round`, `game.ringsClosed`, `game.nextRingIn` (rounds until the next ring closes, or null once all rings are closed), `game.turnOrder` (players in order this round), `game.active` (current player or null), `game.humanId`, `game.over`, `game.winner`.
- `game.log` is an array of strings (newest last).

### Human and bot control

Every player has a controller: `{ takeTurn(game, player) -> Promise, chooseCache(game, player, options) -> Promise<{index, stat?}> }`. CORE calls `takeTurn` after its own start-of-turn processing. While it is running, the controller drives the turn through the methods below. When its promise resolves, CORE runs end of turn. A Move stance ends the turn on its own, so after `doMove` the controller should resolve.

```js
game.walkTargets(p)                  -> [{x,y}]  // legal Move-stance destinations ([] if rooted or the stance is already 'act')
await game.doMove(p, {x,y})          // Move stance: walk there, draw 1; the controller then resolves takeTurn
game.canPlay(p, uid)                 -> { ok, reason }   // energy, root, stance, etc.
game.cardTargets(p, uid, picks)      -> [{x,y}]
game.cardArea(p, uid, picks)         -> [{x,y}]
await game.playCard(p, uid, picks)
game.canUseGb(p)                     -> { ok, reason }
game.gbTargets(p, picks), game.gbArea(p, picks)
await game.useGb(p, picks)
game.cardCost(p, uid)                -> number  // after Thousand Cuts and similar
```

Cache `options` is an array of 3: two `{type:'cards', cards:[id,id]}` and one `{type:'shard'}`. Choosing the shard returns `{index, stat:'hp'|'atk'|'def'|'spd'}`.

`AI.createController({ delay: 400 })` returns a controller. Between actions it awaits `game.view.wait(ms)` so the UI can speed this up or skip it. The stub view resolves immediately.

## View interface (CORE → view). Every method returns a Promise.

At runtime `main.js` builds one composite object: 3D methods come from `VIEW`, and banner, log, refresh and gameOver are also forwarded to `UI`. `CORE.stubView()` returns an object with every method resolving at once.

| Method | Meaning |
|---|---|
| `init(game)` | Build the board and pieces for a new match |
| `refresh(game)` | State changed (hp, energy, hand, meter, statuses). Update bars, glows and HUD with no animation. CORE calls it often, so keep it cheap. |
| `wait(ms)` | Pacing delay (scaled by the speed setting) |
| `roundStart(round)` | |
| `turnStart(player)` | Camera eases to the piece, active ring, HUD |
| `tilesChanged(tiles)` | Re-sync these tiles (h, corrupted, warning, pillar, cache, trap, marked) |
| `move(entity, path, mode)` | `path` is `[{x,y},...]`, starting with the start tile. `mode` is one of `'walk' 'dash' 'teleport' 'push' 'pull'`. |
| `collide(entity, dir)` | Push blocked: dust burst. `dir` is `{dx,dy}` |
| `attack(user, spec)` | `spec = {style:'melee'|'projectile'|'beam'|'area'|'self', from:{x,y}, target:{x,y}, tiles:[{x,y}], color, cardId}`. Plays the windup and travel; resolves at impact. |
| `hit(entity, amount, info)` | `info = {pierce, source:'card'|'corruption'|'trap'|'collision'|'reflect'|'dot', absorbed /*by shield*/, big}`. Shows the damage number and recoil, plus a violet burst when the source is corruption. |
| `heal(entity, amount)` | Sparks and a green number |
| `shield(entity, amount)` | Hex-sphere pulse |
| `status(entity, type)` | `type` is one of `root sap curse renew veil tether undying finalform bastion perch vanish rotembrace aim` |
| `death(entity, place)` | Shatter |
| `spawn(entity)` / `remove(entity)` | Decoys appearing and vanishing |
| `ringWarning(ring, tiles)` | Start warning pulse |
| `ringClose(ring, tiles)` | Sweep corruption across tiles in the order given, with rumble |
| `fx(type, data)` | `'cache-open' {entity,tile}`, `'trap-placed' {tile,ownerId}`, `'trap-trigger' {tile,entity}`, `'tile-raise' {tiles}`, `'cleanse' {tiles}`, `'corrupt' {tiles}`, `'draw' {player,n}`, `'mark' {tiles}`, `'gamebreaker' {gb, user, picks, tiles}` (big 1–2s show, unique per gb id), `'decoy-hit' {entity}` |
| `banner(text, kind)` | `kind` is one of `turn ring gb elim info` |
| `log(text)` | |
| `gameOver(results)` | `results = { winnerId, placements:[playerId by place], players:[{id,name,cls,place,stats}] }` |

## VIEW: extra synchronous API for the UI (not called by CORE)

```js
VIEW.mount(stageEl, overlayEl)     // create the renderer and canvas in stageEl; DOM health bars and floating numbers go in overlayEl
VIEW.setInsets({top, bottom})      // px covered by HUD; the camera frames the board above the hand using setViewOffset
VIEW.setSpeed(mult)                // 1 or 2; also scales wait() and animations
VIEW.setReducedMotion(bool)
VIEW.onTap = (hit) => {}           // hit = {tile:{x,y}|null, entity|null}, after an 8px tap/drag threshold
VIEW.highlight({ targets:[{x,y}], area:[{x,y}], color })  // candidate tiles (soft) and affected area (strong)
VIEW.clearHighlight()
VIEW.setHumanId(id)                // traps visible only to this player; invisible enemies hidden
VIEW.pedestal(canvasEl) -> { set(clsId, variantId, colorIndex), resize(), dispose() }   // loadout preview: rotating piece on a glowing pedestal; swipe handled by the UI
VIEW.portrait(clsId, variantId, colorIndex) -> dataURL   // small head-and-shoulders render for the turn strip and end screen (cached)
VIEW.buildPiece(clsId, variantId, colorHex) -> THREE.Group
VIEW.stop()                        // pause the render loop (on the loadout screen)
```

Use one WebGLRenderer for both the match stage and the pedestal if you can (re-parent the canvas), or two at most.
