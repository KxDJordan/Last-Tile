# LAST TILE: Graphics notes (src/view.js, global `VIEW`)

## Using VIEW

Every CORE-facing method returns a Promise and matches CONTRACT.md:
`init refresh wait roundStart turnStart tilesChanged move collide attack hit heal shield status death spawn remove ringWarning ringClose fx banner log gameOver`.
`banner`, `log` and `gameOver` are no-ops that resolve immediately (UI owns them).

UI sync API (also per contract):

```js
VIEW.mount(stageEl, overlayEl)   // creates the single WebGLRenderer; canvas goes in stageEl, bars and numbers in overlayEl
VIEW.setInsets({top, bottom})    // px covered by the HUD; the camera re-fits so the board fills the width above the hand
VIEW.setSpeed(m)                 // scales wait(), tweens, particles and transient FX (any value >= 0.25)
VIEW.setReducedMotion(b)         // 30% screen shake, half particles
VIEW.onTap = hit => {}           // {tile:{x,y}|null, entity|null}; 8px tap/drag threshold; pieces win over tiles
VIEW.highlight({targets, area, color}); VIEW.clearHighlight()
VIEW.setHumanId(id)              // traps shown only for this owner; this player's invisible piece shows as a ghost, others are hidden
VIEW.pedestal(canvas) -> {set(cls, variant, colorIndex|'#hex'), resize(), dispose()}
VIEW.portrait(cls, variant, colorIndex|'#hex') -> dataURL   // 128x128 PNG, transparent background, cached
VIEW.buildPiece(cls, variant, colorHex) -> THREE.Group
VIEW.stop()                      // pause match rendering (the pedestal keeps rendering)
```

Optional extras: `VIEW.start()` resumes match rendering (main.js already calls it). Also `VIEW.resetCamera()`, `VIEW.pick(clientX, clientY)`, `VIEW.shake(amount, ms)` and `VIEW._debug` (used by tests).

Rendering resumes on its own when `init`, `turnStart` or `start` is called. Each frame is skipped when the stage has zero size, the page is hidden or `stop()` was called. The rAF loop only runs while something is visible or animating.

## Renderer and performance
- **One WebGLRenderer.** The pedestal and portraits render with the same renderer and are copied to the pedestal's 2D canvas with `drawImage`. Pass the pedestal a plain `<canvas>` that has no WebGL context.
- Pixel ratio is capped at 2. There's one shadow caster: a 2048 PCFSoft key light. The PMREM environment map is generated from a tiny gradient scene so metal reads nicely.
- Tiles are 2 InstancedMeshes (beveled caps and column bodies, with per-instance colour). Geometries and materials are cached and shared across pieces.
- There are 3 particle pools (additive FX, dust and corruption motes), each a single `THREE.Points` draw call.
- Every tween has a `setTimeout` safety net, so a promise can never hang, even with the tab hidden or rendering stopped.

## Assumptions about game state
- `game.tiles[y][x]` has `{h, corrupted, warning, pillar, cache, trap:{ownerId,kind}, marked}`, and `game.size` (or `tiles.length`) is used for N.
- The view reads state when `tilesChanged`, `ringWarning`, `ringClose` and `fx` are called. CORE must update the state first, which it does. `ringClose` sorts the tiles it gets by angle, so the sweep goes clockwise around the ring.
- `refresh` never touches tiles. It syncs pieces, bars, shield bubbles, auras and invisibility. If an entity's x/y changes without a `move()` call (for example Grand Swap state edits), the piece snaps there about 150 ms later.
- `move(entity, path, mode)` animates from `path[0]` to the last tile. Hidden (invisible enemy) pieces move silently, so nothing gets revealed.
- Entities are matched by `String(id)`. Decoys (`isDecoy`, `ownerId`) render the owner's model, name and hp. Entities that disappear from `game.entities` are removed on the next `refresh`.
- Player colour is `p.color`, then `DATA.TEAM_COLORS[p.colorIndex]`, then a built-in palette.
- Class and variant ids are matched loosely (`blood_oracle`, `bloodOracle`, `Blood Oracle` or the index 0-2 all work), and so are Gamebreaker ids (`iron_tide`, `ironTide`, `IronTide` and so on). Unknown ids get a generic effect.
- The GB-ready aura shows when `p.meter >= DATA.GAMEBREAKERS[p.gb].cost`, and is guarded if DATA is missing.
- `hit(entity, amount, info)`: `amount` is the full damage and `info.absorbed` is the shielded part. The red number shows `amount - absorbed` and a blue shield number shows `absorbed`. With no HP loss it shows a blue "Block".
- `tile.perchLock` (Eagle's Perch) shows a pulsing green rune on the tile, and level-3 tiles get the lightest stone colour. `ringWarning(5, ...)` and `ringClose(5, ...)` (sudden death, every tile) sweep fine.
- Decoys: `fx('decoy-hit')` puffs, then `remove()` shrinks and removes them. Swaps (two concurrent teleport moves) animate independently.
- Statuses with no `view.status` call (vanishdmg, siphon, skyfall) need no visuals. Skyfall is drawn from `tile.marked`.
- `attack(user, spec)` uses `spec.color` when given (CORE passes the class colour), otherwise the class glow colour. `area` tiles flash staggered outward from `spec.target`. `beam` runs to the farthest tile in `spec.tiles`.

## Notes for the UI agent
- VIEW injects its own `<style id="ltv-style">` (classes `ltv-*`) for the overlay bars and floating numbers, and creates a `.ltv-layer` div inside `overlayEl`. Leave `overlayEl` positioned (absolute or relative) so it covers the stage. Its pointer-events can stay `none`.
- Floating numbers use Cinzel and bars use Inter, both with fallbacks.
- Call `setInsets` whenever the HUD size changes (main.js already does). Pinch zoom range is 0.55-1.45x of the fitted distance, and drag rotates or tilts.
- Highlights: `targets` are soft pulsing outlines and `area` tiles are strong filled tiles, both in `color`.

## Visual summary
Twilight sky dome (gradient plus 700 stars, a sun glow on the horizon), a cloud sea below and light exp fog. ACES tone mapping and sRGB output. The lighting is a warm key with soft shadows, a cool hemisphere fill, a cool rim light that stays behind the board relative to the camera, and a magenta under-light on the island.

The island is a flat-shaded squircle rock mass with vertex-colour strata, a rubble ring, 9 hanging spikes and 8 drifting fragments (some carry corruption crystals). Tiles are beveled stone caps with a canvas stone texture and bump, per-tile tint variation and four distinct level colours plus height (0.34 per level).

Corrupted tiles get a vein texture with a pulsing emissive and shared mote particles. Warning tiles pulse a magenta outline. Pillars are fluted broken columns with chipped tops and gold bands. Caches are bobbing gilded chests with glow sprites. Traps are faint owner-only glyphs. Skyfall marks are orange tiles plus a large rotating crosshair over a 3x3 area.

All 18 pieces are procedural miniatures. Each has a team-colour emissive rim and a ground glow, plus its own idle animation (orbiting daggers, sparks and crystals, flapping wings, a swinging lantern, a waving scarf and so on).

Each Gamebreaker has a unique 1-2 s showpiece. The scene dims during it, and the UI shows the banner.

## Testing
- `test/view-sandbox.html` is a mock 12x12 game with 8 players. Use `?mode=board`, `?mode=demo` (exercises every method plus all 18 GBs), `?mode=sheet` (contact sheet of all 18 variants) or `?mode=ped&cls=..&variant=..` (pedestal plus portraits).
- `node test/view-shots.js board sheet sheetbig corrupt fxs gbs demo tap ped` writes `test/shots/*.png`. `FX=`, `GB=` and `ZOOM=` env vars filter or zoom.
- `node build.js && node test/game-shots.js` runs the real game: a loadout shot and match frames.
- `test/view-real.html` runs the real CORE and AI with 8 bots driving VIEW (`node test/view-shots.js --real`). A full match (14 rounds, 7 deaths, decoys, 6 Gamebreakers, ring closes) ran with 0 errors.
- The full sandbox demo and the built game ran with no console errors (only the expected blocked Google Fonts request).
