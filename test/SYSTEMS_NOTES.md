# LAST TILE: Systems notes (DATA / CORE / AI)

## How to run the tests

```sh
node test/headless.js 400            # 400 headless 8-bot matches (default N=200). Add --seed=S, --verbose, --gb (win rate per Gamebreaker)
node test/rules.js                   # unit tests for the key rules (79 checks)
node test/cards.js 40                # plays every card and every Gamebreaker 40x on random crowded boards, checks invariants
node test/api.js 30                  # one seat played through the public UI API with random legal choices
```

Every script exits with a non-zero code on any error or invariant violation.

`headless.js` gives the 8 seats 6 classes in rotation, so each class appears equally often (about 533 times in 400 matches). Loadouts come from `DATA.randomLoadout`, the view is `CORE.stubView()`, and the AI runs with delay 0. The script catches every exception (from the run and from `game.errors`). Three checks catch stuck matches: a 4000-turn step limit, a 20 s wall-clock watchdog per match, and the CORE round cap of 60. It checks these invariants at every `refresh` and `turnStart`:
- no two pieces share a tile, and no piece stands on a pillar or off the board;
- hp ≤ maxHp; 0 ≤ moveLeft ≤ moveMax; energy, shield and meter are never negative (meter is also never above 100); hand ≤ 7; no live player has hp ≤ 0;
- deck + hand + discard = 16 base cards per live player (temp and cache cards excluded), with no duplicate uids;
- every move path ends at the entity's position, and every move mode is legal;
- placements are exactly 1..8;
- every starter deck and 300 random loadouts pass `validateDeck` / `validateLoadout`;
- all 56 cards and 18 Gamebreakers exist and have targets, area, apply, text, key and pickCount, and their text renders without NaN or undefined.

## Free movement (rule change after v1.0)

There is no longer a Move/Act stance. Each turn a player may walk and play cards in any order:
- At refill time CORE sets `p.moveMax = min(MOVE_CAP, effective SPD)`, where effective SPD is `game.stats(p).spd` (shards, Final Form and the rest included) and `MOVE_CAP` is 4. It also sets `p.moveLeft = p.moveMax`, or 0 if rooted.
- Walking can happen before, between or after card plays, in any number of separate walks, until `moveLeft` runs out. A flat step costs 1 and a step up 1 level costs 2. Steps up 2+ levels are impossible, and pillars, pieces and a perched tile block, as before. Walking never draws a card and never ends the turn; only `takeTurn` resolving ends it.
- Picking up a root (a Snare) mid-turn sets `moveLeft` to 0 immediately.
- Movement cards are extra movement and don't use `moveLeft`.
- `p.stance` is still there but stays `null`; nothing reads it.

## Final results (after balancing for free movement)

| class | win % (400 matches, seed 1000) | win % (400 matches, seed 99) |
|---|---|---|
| Vanguard | 23.5 | 20.5 |
| Striker | 16.5 | 16.0 |
| Marksman | 11.5 | 12.0 |
| Phantom | 16.8 | 17.8 |
| Lifebinder | 16.3 | 21.0 |
| Hexer | 15.5 | 12.8 |

"Win %" is the share of matches won by any player of that class. 16.7% would be perfectly even.
- Errors: 0. Invariant violations: 0. Stuck matches: 0. Matches ended by the round cap: 0 (both seeds).
- Rounds per match: average 18.0, median 19, range 10–21.
- About 18% of eliminations are corruption deaths (rings or sudden death), down from 26% before free movement; the rest are kills.
- About 72% of matches reach sudden death (round 19), with 2–3 players usually left. Fights are deadlier now: about 2.4 players are alive at round 16, against 3.5 before. Sudden death is still needed to end most games, so it is unchanged.

Before free movement (v1.0, 360 + 300 matches): Vanguard 23.1/19.7, Striker 12.5/11.7, Marksman 10.8/10.3, Phantom 16.7/19.0, Lifebinder 24.7/25.0, Hexer 12.2/14.3.
Free movement with the v1.0 numbers unchanged (240 matches): Vanguard 28.3, Striker 10.8, Marksman 11.7, Phantom 21.3, Lifebinder 18.8, Hexer 9.2. Phantom's passive was nearly always on and the ranged classes were run down.

## Balance changes (brief value → final)

Baseline: the v1.0 rules engine and AI with every number exactly as in the brief (300 matches). Vanguard 27.3, Striker **3.3**, Marksman 10.3, Phantom 14.3, Lifebinder **30.0**, Hexer 14.7.

Card and Gamebreaker numbers (the v1.0 pass and the free-movement pass marked "FM"):
| change | brief | final | why |
|---|---|---|---|
| Striker passive (Momentum) | +2 | +2 (v1.0 had +3) | FM: Flow is almost always on now, so back to the brief value |
| Phantom passive (Elusive) | moved last turn | **moved 3+ tiles last turn** | FM: otherwise it is always on |
| Flurry | 2× (1 + ATK) | **2× (2 + ATK)** | DEF wiped out its small hits |
| Rising Kick | 2 + ATK | **3 + ATK** | Striker |
| Breaker Rush bonus hit | 2 + ATK | **3 + ATK** | Striker |
| Haymaker | 5 + ATK×1.5 | **6 + ATK×1.5** | Striker |
| Second Wind | 3 + SPD + HPpts | **5 + SPD + HPpts** | Striker died early |
| Blitz Chain cost | 80 | **70** | weakest Striker Gamebreaker |
| Blitz Step (temp card) | walk 2 | **walk 3** | FM: free walking made it near-useless |
| Long Shot | 3 + ATK | **5 + ATK** | Marksman (v1.0 +1, FM +1) |
| Piercing Bolt | 2 + ATK | **3 + ATK** | 3-cost card was weak |
| Scatter Shot | 2 + ATK | **3 + ATK** | Marksman |
| Field Dressing | 5 + HPpts | **7 + HPpts** | Marksman (v1.0 +1, FM +1) |
| Climb | walk 2, free climbing | **walk 3**, free climbing | FM: movement cards compete with free walking |
| Grapple cost | 2 | **1** | FM: same |
| Skyfall Volley cost | 100 | **80** | FM: easy to walk out of the marked area |
| Hex Bolt | 2 + ATK | **3 + ATK** | FM: Hexer was run down |
| Rot Lash cost | 3 | **2** | FM: Hexer |
| Bulwark | 3 + DEF×1.5 | **2 + DEF×1.5** | Vanguard too sturdy |
| Fortify shield | 2 + DEF | **1 + DEF** | Vanguard |
| Iron Will | 3 + DEF + HPpts | **2 + DEF + HPpts** | Vanguard |
| Iron Tide hit | 4 + DEF + ATK | **3 + DEF + ATK** | Vanguard |
| Last Bastion shield | DEF×3 + 3 | **DEF + 3** | Vanguard (v1.0 DEF×2+3, FM again) |
| Earthshatter | 2 + DEF×2 | **1 + DEF×2** | FM: Vanguard |
| Mending Light | 5 + HPpts×1.5 | **4 + HPpts** | Lifebinder |
| Thorn Bloom shield | 2 + HPpts | **1 + HPpts** | Lifebinder |
| Siphon Field drain | 2 + HPpts | **2 + HPpts/2** | 30% per-seat win rate |

Movement and SPD:
- **Walking budget cap `MOVE_CAP = 4`** (`CORE.MOVE_CAP`). SPD still sets turn order and powers Phantom, Second Wind and Sprint, but a piece never walks more than 4 tiles per turn. With cap 5, high-SPD Phantoms dominated; uncapped SPD goes up to 7+ with shards.
- Flow cards (Backstab +2, Haymaker +3, Rising Kick push) keep their brief and v1.0 values. Flow now costs part of the walking budget rather than a whole turn, which is enough.

Bot stat-spread weights (`DATA.BOT_WEIGHTS`, hp / atk / def / spd): vanguard 2 / 2.5 / 1.5 / 1.5; striker 4 / 3 / 2 / 1; marksman 4 / 3 / 2 / 2; phantom 3 / 0.5 / 1.5 / 3; lifebinder 2.5 / 2 / 1 / 1.5; hexer 2.5 / 3 / 1 / 2. Classes that need to kite got more SPD; the tanks got less HP.

AI changes for free movement:
- Bots weigh a free walk (position gain, plus how much better their cards would hit from the new tile) against the best card. They walk first when that improves their attacks; otherwise they play cards and then walk to reposition, which is how Marksman and Hexer kite, or step off corruption, or grab a cache.
- Movement cards whose destination is in plain walking range are scored as wasted.
- Bots value staying on their own Eagle's Perch.
- The "avoid hard targets" term is weaker (0.6 → 0.35 per DEF point), so bots no longer leave tanks alone until sudden death.

Rule-level changes made for balance or to end stalls (also listed under design decisions):
- Shields last until the start of the owner's next turn. Without this, stacked Vanguard shields reached 30+ and produced 2-player stalemates that ran to the round cap.
- A sudden-death phase guarantees an ending (see below).

## Design decisions (where the brief left room)

Geometry and targeting
- "Within N" uses Manhattan distance. Line of sight samples the line between tile centres: pillars block it, elevation does not.
- Damage cards target tiles, so an empty tile is a legal target. Ranged single-target cards (Long Shot, Sling Shot, Hex Bolt, Sap, Withering Curse, Grasping Rot, Flicker Strike) need line of sight. Blood Tether, traps, teleports and Blight Seed do not.
- Direction cards: the pick is one of the 4 adjacent non-pillar tiles. Push and pull use the dominant axis from user to target, and a diagonal when the target sits exactly on a diagonal (Earthshatter, Dagger Fan targets).
- The cone is 1 tile, then the 3 tiles at distance 2. Diagonal X is (±k, ±k) for k = 1, 2.
- Lines stop at pillars, except Railpiercer, which crosses the whole board.
- Marksman passive: +1 range per level above the target tile, applied to ranged single-target cards. Eagle's Perch adds +2 range to these and to Piercing Bolt's length.

Movement
- Walking uses Dijkstra with costs of 1, or 2 for stepping up 1 level (Climb: always 1). Stepping up 2 or more levels is impossible. Pieces, pillars and a perched tile block movement. A walk must end on a different tile. Free walking takes the cheapest path within `moveLeft`.
- Flow ("moved this turn") is true once your piece has changed position during your turn by any means. Phantom's passive counts tiles moved last turn (Manhattan distance per move, teleports and swaps included) and needs 3 or more.
- Dash: a straight line that may step up 1 level per tile at no extra cost and stops before a blocked tile. The pick is the destination.
- Traps and caches trigger only on the tile where a move ends ("landing"), whether by walk, dash, teleport, push, pull or swap.
- Push/pull: a piece is blocked by the board edge, a pillar, another piece, a perched tile, or a step up of 2+ levels, and takes 2 pierce collision damage. A pull stops without collision when the next tile holds the puller. Last Bastion makes a piece immune to push, pull and swap.
- Flicker Strike teleports to the empty tile next to the target that is closest to the user. Breaker Rush hits the adjacent enemy with the lowest HP.
- Eagle's Perch sets the tile to h = 3 and locks it. When the status ends, the tile returns to its original height.

Turn and status rules
- Durations count down at the start of the affected player's turn, after start-of-turn effects; a status is removed at 0. "For N rounds" self-buffs use N. Sap uses 3, so it affects 2 of the target's turns. Root uses 2, so it covers the target's next turn. Vanish uses 1, so it lasts until your next turn. Steady Aim, Smoke Veil and Vanish's double damage last until used.
- At the start of every turn, shields drop to 0. The Vanguard passive then raises the shield to DEF.
- Striker passive: the first Damage card each turn uses up the bonus, whether or not you moved. Damage modifiers (Striker, Steady Aim, Vanish double) apply to every hit of that card; for Flurry, that is both hits.
- Meter: +10 once per Damage card that hits at least one real player (hitting decoys and Gamebreaker damage give none). +5 for each instance of damage taken. +15 for opening a cache. +20 to everyone alive when a ring closes. The meter is capped at 100.
- Lifebinder passive: heal 1 for each damage instance it deals, shield-absorbed damage included.
- Phantom passive: the first card, trap, collision or reflect hit each round uses it up. It halves the damage (minimum 1) if the Phantom moved 3+ tiles during its last turn. Smoke Veil also halves (minimum 1) and is consumed by the next such hit. Corruption and curse damage are not "hits".
- Invisible (Vanish) players cannot be damaged, displaced or debuffed by enemies, and the AI cannot see them. They still block movement and still take corruption.
- Decoys block movement and can be pushed or swapped. Any damage or debuff destroys a decoy (`fx('decoy-hit')`, then `remove`). Decoys ignore corruption and traps. They disappear when their owner dies. Your own attacks never hit you or your decoys, and that includes Skyfall.
- Mirror Legion has pickCount 0: CORE places the 2 decoys on random empty tiles within 2.
- The hand is capped at 7. Draws stop at 7 rather than burning cards. A cache card goes to the hand, or to the discard if the hand is full. It joins the card cycle permanently and is flagged `cache: true`.
- Cache options: two `{type:'cards'}` options, each with 2 random cards from the class and general pool, plus one shard. An HP shard raises max HP by 5 and heals 5.
- Traps: you cannot target a tile that holds your own trap. Placing a trap on a tile with an enemy trap silently replaces it, so the candidate list leaks no information. A dead player's traps are removed.
- Corruption caused by players (Blight Seed, Blight Bloom, Rot Embrace) never touches the centre 2×2.
- Turn order: SPD descending, then lower current HP, then a seeded random draw, fixed at the start of each round.
- The 8 player names are unique. The human keeps its loadout name. Bots use `loadout.name` when it is unique, otherwise a name from `DATA.BOT_NAMES`.

Board
- Heights come from smoothed value noise quantised by percentile (about 42% level 0, 36% level 1, 22% level 2). The centre 2×2 is level 0–1 and pillar-free.
- 8 pillars, never adjacent to each other or to spawns. Flood fill keeps every open tile connected. Heights are then repaired so every tile can be reached from the centre with |Δh| ≤ 1 steps.
- 8 spawns sit evenly around ring 1. Up to 10 caches sit on rings 0–3, at least 2 tiles apart.

Sudden death (an addition: the brief ends the schedule at ring 4)
- Three rounds after the last ring closes (round 19), the rot surges. Every tile corrupts, the centre included, through `view.ringClose(5, tiles)`, with `view.ringWarning(5, tiles)` the round before. After that it surges every round, adding +3 corruption damage each time.
- While sudden death lasts: healing is halved; Cleanse and Sanctuary can't be played; the Hexer passive, Riftwalker and Rot Embrace do not reduce corruption damage. Without these limits, Cleanse made permanent safe tiles and Hexers could never die.
- The round cap of 60 stays as a safety net (the remaining player with the highest HP wins). It was never reached in testing.

## API surface beyond CONTRACT.md

DATA
- `STAT_BASE`, `STAT_PER`, `STAT_INFO` (`{hp:{name,desc},...}` for the Stats tab), `POINTS_TOTAL` (10), `POINTS_MAX` (6), `DECK_SIZE` (16), `BOT_NAMES`, `BOT_WEIGHTS`, `CARD_ORDER`.
- `classCards(cls)`, `generalCards()`, `patterns` (adjacent, around, cross, line, cone, diagX, square, within, dirOf, dist, cheb), `DIRS4`, `DIRS8`, `isCenter(t)`, `onCorruption(g,e)`, `nearCorruption(g,e)`.
- `DATA.CARDS.blitz_step` is the temporary card (`cls:'temp'`, cost 0). It is in no pool and fails deck validation.
- Some cards carry optional helper functions: `amt(g,u,e,picks,s)` (damage cards), `heal(s)`, `shieldAmt(s)`, `trapDmg(s)`, `hits` (Flurry = 2) and an `ai` hint object.
- `randomLoadout(rng, cls?)` also sets `name`. Without an rng it falls back to Math.random (DATA only; CORE and AI always use seeded RNG).
- Card `key()` strings can contain `×`, `½` and `−` (for example "2×6", "3×3").

CORE
- `CORE.MOVE_CAP` (4), `CORE.STRIKER_BONUS` (2), `CORE.PHANTOM_TILES` (3), `CORE.mulberry32(seed)`, `CORE.VIEW_METHODS`, `CORE.ringOf(x,y)`, and the constants `RING_FIRST`, `RING_EVERY`, `RINGS_TOTAL`, `HAND_MAX`.
- `new CORE.Game({... maxRounds})` sets the optional round cap (default 60). Any view method missing from the `view` object passed in is filled with a resolving stub, in place on that same object.
- Extra game state: `seed`, `surges` (sudden-death count), `nextSurgeIn` (rounds until the centre falls or the next surge, once all rings are closed, else null), `endedByCap`, `errors` (controller and card exceptions are caught here so a match never hangs), `decoys`, `spawns`, `turnCount`.
- Tile extras: `perchLock` (null or ownerId), `cache = {id}`, `trap = {ownerId, kind:'snare'|'caltrops', dmg, root}`.
- Player extras: `moveMax`, `moveLeft`, `points`, `shards`, `turnFlags` (`thousandCuts`, `blitz`, `riftwalk`, `strikerUsed`), `turnDone`, `movedLastTurn`, `tilesMovedThisTurn`, `tilesMovedLastTurn`, `loadout`. `stance` is always null.
- Movement API: `walkTargets(p)` lists the tiles reachable within `p.moveLeft` (`[]` when it isn't p's turn, the turn is over, p is rooted or `moveLeft` is 0). `await doMove(p, {x,y})` walks the cheapest path, subtracts its cost from `moveLeft`, triggers traps and caches, sets Flow, calls `refresh` and resolves `true`; it resolves `false` with no side effects if the tile is out of reach. `walkCost(p, {x,y})` is the cost of the cheapest walking path ignoring the remaining budget (0 for p's own tile, `null` if unreachable), for UI previews. `moveAllowance(p)` returns `min(MOVE_CAP, SPD)`.
- `canPlay` and `canUseGb` no longer give "You moved this turn"; after the turn ends the reason is "Turn is over".
- Statuses not in the view list live in `p.statuses` with no `view.status` call: `vanishdmg`, `siphon`, `skyfall` (holds `tiles`).
- Read helpers: `pieceAt(x,y)`, `isEmpty`, `isEnemy(u,e)`, `canAffect(u,e)`, `ownerOf(e)`, `hpOf(e)`, `hasStatus(p,type)`, `alivePlayers()`, `corruptionDamage(p)`, `rangeBonus(u,t)`, `los(a,b)`, `reachable(p,budget,{climbFree})`, `dashTargets`, `results()`, `ringTiles(k)`.
- `doMove`, `playCard` and `useGb` resolve `true`/`false`. Illegal picks are refused (`false`) with no side effects.
- `results()` and the `gameOver` payload also carry `rounds` and `endedByCap`.

AI
- `AI.createController({delay})` returns `{takeTurn, chooseCache, isBot:true}`. Each turn is capped at 12 actions, with an extra stop after 4 refused actions.
- Debug exports: `AI.perceive(g,p)`, `AI.CLASS_AI`, `AI.REACH`, `AI._score`, `AI._walk`, `AI._gb`.
- Behaviour per class (`CLASS_AI`): ideal range (melee 1, Marksman 4, Hexer 3, others 2), aggression, weights for healing, shields and elevation, a retreat HP threshold and a threat weight.
- Position value: corruption, warning and soon-to-close rings, caches, Skyfall marks, pull toward the centre, elevation, the ideal range to the best target (favouring enemies it can actually hurt) and the estimated incoming threat.
- Bots never target their own decoys, treat enemy decoys as real (using the owner's HP), never read enemy traps and never see invisible enemies.

## Notes for the UI and Graphics agents
- The `view.ringClose` and `view.ringWarning` ring index can be **5** (the centre) during sudden death. Its tile list may include re-corrupted tiles from any ring.
- CORE calls `view.banner('Your turn','turn')` at the start of the human's turn. If the UI also shows its own turn banner, drop one of the two.
- `chooseCache` can be called on the human controller during another player's turn, when the human is pushed, pulled or swapped onto a cache.
- A swap is two `view.move(..., 'teleport')` calls started together. Both pieces already hold their new positions when the calls begin.
- A hit on a decoy never calls `view.hit`. CORE calls `fx('decoy-hit',{entity})` and then `remove(entity)`.
- Hits on a shield report the full amount in `hit(entity, amount, info)`, with `info.absorbed` giving the shielded part.
