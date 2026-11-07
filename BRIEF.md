# BUILD BRIEF: "LAST TILE" — Mobile Battle Royale Tactics TCG (v1.0)

You are building a complete, production-quality v1.0 of a mobile-first battle royale x trading card game as a SINGLE self-contained HTML file. Work as two roles (sequentially or as two agents):

1. **Systems Engineer:** game rules, data, AI, turn flow, and testing.
2. **Graphics & UX Lead:** dedicated to making this look and feel like a polished, shipped mobile game: lighting, materials, piece models, VFX, animation, and UI. Graphics is not an afterthought; budget a full pass for it after systems are stable.

Ask no clarifying questions; where something is unspecified, make a sensible choice and list it in a short "Design decisions" note at the end.

---

## 1. Technical constraints

- One `.html` file. All CSS and JS inline. No external assets except:
  - Three.js **r128** UMD from `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` (exact version; `OrbitControls`, `EffectComposer`, and `CapsuleGeometry` are NOT available, so build those behaviors yourself or avoid them).
  - Google Fonts (with full fallback font stacks).
- All textures generated procedurally (canvas textures). No remote images.
- Portrait mobile first (360–430px wide), still usable on desktop.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; respect `env(safe-area-inset-*)` for top/bottom UI.
- Touch controls: tap, drag, pinch. Minimum touch target 44px.
- Target 60fps on a mid-range phone: pixel ratio capped at 2, shared geometries and materials, one shadow-casting light, particle counts kept modest.
- Use try/catch around any `localStorage` access (used only for saved loadout presets).

### Architecture (required)
Split code into clearly separated modules inside the file:
- `DATA`: classes, variants, cards, Gamebreakers.
- `CORE`: the `Game` class with all rules. It must NOT touch the DOM or THREE directly. It calls an injected `view` interface whose methods return Promises (e.g., `view.move(entity, path, mode)`, `view.hit(entity, amount)`, `view.fx(type, data)`, `view.tilesChanged(tiles)`).
- `AI`: decision-making for bot players, also DOM-free.
- `VIEW`: Three.js rendering, implementing the view interface.
- `UI`: DOM screens and HUD.

This separation is mandatory so CORE + AI can run headless with a stub view (all methods resolve immediately). **Before the graphics pass, run at least 200 headless 8-bot matches and fix every exception, infinite loop, and stuck turn.** Report win rates by class; if any class wins more than 30% or under 8%, adjust numbers and retest.

---

## 2. Game overview

8 players on a 12×12 square board in 2.5D/3D. The board corrupts from the outside in, ring by ring. Each player is one piece. On each turn, a player either **Moves** (basic walk) or **Acts** (plays skill cards from their deck). The deck controls what you can do. Last piece standing wins.

v1.0 mode: **Solo vs 7 AI bots** (random classes, variants, stat spreads, and Gamebreakers).

---

## 3. Loadout screen (main screen)

The first screen. Upper area shows the selected piece in 3D on a glowing pedestal, slowly rotating. Bottom sheet with tabs.

**Class selection:** swipe the piece or tap side arrows to change class. Show class name, role line, and passive.

**Piece selection:** 3 piece variants per class (Section 6), selected via 3 named buttons under the class name.

**Tabs:**
1. **Stats:** Distribute exactly 10 points among HP, ATK, DEF, SPD. Max 6 points in any one stat. Each row: name, short description, pip bar, − and + buttons, and the resulting value ("HP 40"). Show "Points remaining."
2. **Gamebreaker:** 3 options for the current class, each showing name, charge cost, and effect text with numbers computed live from current stats. Selected one glows.
3. **Deck:** Shows the 16-card deck and the available card pool (class cards + general cards). Tap a deck card to remove it, tap a pool card to add it. Show rule checks live (Section 5).
4. **Presets:** 4 named save slots storing class, variant, stats, Gamebreaker, deck.

**Live numbers everywhere:** every card and Gamebreaker text on this screen updates instantly when stats change.

**Play button** at the bottom: disabled with a clear reason ("Spend 3 more points", "Deck needs 1 more Recovery card") until the loadout is valid.

Changing class resets the deck to that class's starter deck.

---

## 4. Stats and combat math

| Stat | Base | Per point |
|---|---|---|
| HP | 20 | +5 max HP |
| ATK | 1 | +1 |
| DEF | 0 | +1 |
| SPD | 1 | +1 |

In card text: `ATK`, `DEF`, `SPD` mean effective stat values; `HPpts` means points invested in HP (including shards).

- **Damage taken** = amount − target DEF, minimum 1. Shields absorb damage before HP. "Pierce" damage ignores DEF.
- **Corruption damage** = 3 + 2 × rings closed, ignores DEF and shields.
- **Turn order** each round: highest SPD first. Tie → lower current HP first → then random.
- **Energy:** refills each turn to 3 + rings closed (max 6).
- **Hand:** draw up to 5 at the start of your turn. Max hand 7. Empty deck → shuffle discard into deck.

### Turn structure
At the start of your turn: apply start-of-turn statuses, then decrement durations, then refill Energy, then draw.

Choose a stance (implicitly, by your first action):
- **Move:** walk up to 2 tiles (no cards played), then draw 1 card. Ends turn.
- **Act:** play any number of cards you can afford with Energy. You may also use your Gamebreaker (costs no Energy, does NOT end turn, once per turn). Tap End Turn when done.

At end of turn: if on a corrupted tile, take corruption damage.

### Movement rules
- Orthogonal steps only.
- Tile elevation 0–2. Stepping up 1 level costs 2 movement. Up 2+ levels is impossible. Down is free.
- Can't move through pillars or other pieces.
- **Flow:** "you moved this turn" — true if your piece changed position during your current turn by any means.

### Push / Pull
Moves the target tile-by-tile. If blocked by the edge, a pillar, a piece, or a 2+ level wall, the target stops and takes 2 pierce collision damage. Traps and caches trigger when a piece lands on them.

---

## 5. Deckbuilding rules

- Exactly 16 cards.
- At least 10 class cards; at most 6 general cards.
- At least 2 cards of each category: Movement, Damage, Utility, Recovery.
- Max 2 copies of any card.
- Every card has a category and either a class or "General."

**Starter deck** per class: all 8 class cards + 1 extra copy of each of the 2 listed starter-duplicate cards + General: Quick Step, Sprint, Jab, Bandage, Brace, Flare.

---

## 6. Classes, passives, and pieces

Each class has a color theme and 3 distinct piece variants. Pieces are built procedurally from primitives (no imported models) with a strong, readable silhouette at small size: a team-colored base disc with a glowing rim, body, head, and class-specific gear. Each has an idle animation (bob, breathing, orbiting elements).

**Vanguard** — Steel blue. Passive: *At the start of your turn, your shield becomes at least your DEF.* Starter duplicates: Shield Bash, Lance Thrust.
- *Bastion:* knight with a huge tower shield and plumed helm.
- *Colossus:* broad, hulking frame with shoulder plates and a hammer.
- *Warden:* lighter armor, round shield, spear, cape.

**Striker** — Ember orange. Passive: *Your first Damage card each turn deals +2 if you moved this turn.* Starter duplicates: Rising Kick, Flurry.
- *Brawler:* oversized glowing gauntlets, headband.
- *Duelist:* slim build, twin blades, long flowing scarf.
- *Tempest:* crackling energy aura, floating sparks orbiting.

**Marksman** — Forest green. Passive: *+1 range for each elevation level you stand above your target tile.* Starter duplicates: Long Shot, Scatter Shot.
- *Ranger:* hood (cone), longbow, quiver.
- *Gunslinger:* wide-brim hat, long rifle.
- *Artillerist:* backpack cannon, goggles.

**Phantom** — Smoky violet. Passive: *The first time you're hit each round, take half damage if you moved during your last turn.* Starter duplicates: Backstab, Flicker Strike.
- *Shade:* flowing cloak (cone), semi-transparent body.
- *Specter:* masked face, floating orbiting daggers.
- *Veilblade:* sleek ninja form, wisps trailing.

**Lifebinder** — Teal and gold. Passive: *Heal 1 whenever you deal damage.* Starter duplicates: Drain Touch, Life Spear.
- *Verdant:* leafy crown, wooden staff with a glowing seed.
- *Seraph:* halo (torus), small wings, gold staff.
- *Blood Oracle:* crimson robes, floating red orb.

**Hexer** — Corruption magenta. Passive: *Take half corruption damage.* Starter duplicates: Hex Bolt, Rot Lash.
- *Rotcaller:* hunched, horned hood, staff of twisted roots.
- *Witchlight:* tall pointed hat, lantern of purple flame.
- *Void Mask:* floating mask head, orbiting octahedron crystals.

---

## 7. Card targeting system

Damage targets **tiles**, not players; anything standing in the area is hit. Every card defines:
- `targets(game, user, picks)` → candidate tiles for the next pick
- `area(game, user, picks)` → affected tiles to preview
- `apply(game, user, picks)` → async effect
- `text(stats)` → card text with live numbers
- optional AI scoring hints

Pattern helpers to implement: adjacent (4), around (8), cross, line (stops at pillars unless noted), cone (1 tile then 3 tiles), diagonal X, 3×3 square. Ranged single-target cards require line of sight (pillars block). Direction-based cards: the user picks one of the 4 adjacent tiles to choose a direction.

Player flow: tap card → candidate tiles highlight → tap a tile → affected area preview shows → tap again (or Confirm) to play. Cancel at any time. Self-targeted cards go straight to confirm.

---

## 8. Card list (56 cards)

Format: Name — Category — Cost — Effect.

### General
- Quick Step — Movement — 1 — Walk up to 2 tiles.
- Sprint — Movement — 2 — Dash in a straight line up to 2 + SPD/2 (round down) tiles.
- Shove — Movement — 1 — Push an adjacent piece 2 tiles.
- Jab — Damage — 1 — Deal 2 + ATK to an adjacent tile.
- Sling Shot — Damage — 2 — Deal 2 + ATK to a tile within 4.
- Bandage — Recovery — 1 — Restore 4 + HPpts HP.
- Brace — Utility — 1 — Gain a shield of 2 + DEF.
- Flare — Utility — 1 — Draw 2 cards.

### Vanguard
- Shield Bash — Damage — 2 — Deal 2 + DEF to an adjacent tile. Push the target 1.
- Bulwark — Recovery — 1 — Gain a shield of 3 + DEF×1.5.
- Charge — Movement — 2 — Dash up to 3 tiles. Adjacent enemies where you stop take 1 + DEF.
- Fortify — Utility — 2 — Raise your tile 1 level (max 2). Gain a shield of 2 + DEF.
- Ground Slam — Damage — 3 — Deal 2 + DEF + ATK/2 to all 4 adjacent tiles. Push each target 1.
- War Cry — Utility — 1 — Pull every enemy within 3 one tile toward you.
- Iron Will — Recovery — 2 — Restore 3 + DEF + HPpts HP.
- Lance Thrust — Damage — 2 — Deal 3 + ATK to a line of 2.

### Striker
- Rising Kick — Damage — 2 — Deal 2 + ATK to all 4 adjacent tiles. Flow: push each target 1.
- Breaker Rush — Movement — 2 — Dash up to 1 + SPD/2 (round up) tiles. If you stop next to an enemy, deal 2 + ATK to one.
- Flurry — Damage — 1 — Hit an adjacent tile twice for 1 + ATK each.
- Lunge — Movement — 1 — Walk up to 3 tiles.
- Haymaker — Damage — 3 — Deal 5 + ATK×1.5 to an adjacent tile. Flow: +3 damage.
- Second Wind — Recovery — 1 — Restore 3 + SPD + HPpts HP.
- Hook Chain — Movement — 2 — Pull the first piece in a line of 4 to the tile next to you.
- Adrenaline — Utility — 1 — Draw 2. Gain 1 Energy.

### Marksman
- Long Shot — Damage — 2 — Deal 3 + ATK to a tile within 6.
- Piercing Bolt — Damage — 3 — Deal 2 + ATK to every piece in a line of 6.
- Scatter Shot — Damage — 2 — Deal 2 + ATK in a cone.
- Climb — Movement — 1 — Walk up to 2 tiles; climbing costs no extra movement.
- Grapple — Movement — 2 — Teleport to an empty tile within 3.
- Snare — Utility — 1 — Place a trap within 3: deals 2 + ATK and roots (can't walk or use Movement cards next turn).
- Steady Aim — Utility — 1 — Your next Damage card deals +ATK.
- Field Dressing — Recovery — 1 — Restore 5 + HPpts HP.

### Phantom
- Phase Step — Movement — 1 — Teleport to an empty tile within 3.
- Flicker Strike — Damage — 2 — Choose an enemy within 4. Teleport next to it and deal 2 + SPD.
- Shadow Swap — Movement — 2 — Swap places with any piece within 4.
- Caltrops — Utility — 1 — Place a trap within 3 that deals 2 + SPD.
- Smoke Veil — Utility — 2 — The next hit against you deals half damage. Draw 1.
- Backstab — Damage — 2 — Deal 3 + SPD to an adjacent tile. Flow: +2 damage.
- Dagger Fan — Damage — 2 — Deal 1 + SPD to all 8 diagonal tiles within 2.
- Mend Shadows — Recovery — 1 — Restore 3 + SPD + HPpts HP.

### Lifebinder
- Drain Touch — Damage — 2 — Deal 2 + ATK to an adjacent tile. Heal for the damage dealt.
- Renew — Recovery — 1 — Regenerate 2 + HPpts/2 HP at the start of each of your next 3 turns.
- Mending Light — Recovery — 2 — Restore 5 + HPpts×1.5 HP.
- Life Spear — Damage — 2 — Deal 2 + ATK + HPpts/2 to a line of 3.
- Thorn Bloom — Utility — 2 — Gain a shield of 2 + HPpts. Adjacent enemies take 2 + HPpts/2.
- Spirit Step — Movement — 1 — Walk up to 3 tiles. Restore 2 HP.
- Sap — Utility — 1 — An enemy within 3 gets −2 ATK for 2 rounds.
- Sanctuary — Utility — 2 — Cleanse corruption from your tile and adjacent tiles.

### Hexer
- Rot Lash — Damage — 3 — Deal 2 + ATK to a line of 4. +3 to targets on or next to corruption.
- Blight Seed — Utility — 1 — Corrupt a tile within 3 (not the center 2×2).
- Riftwalker — Movement — 2 — Walk up to 3 tiles. Ignore corruption damage this turn.
- Hex Bolt — Damage — 2 — Deal 2 + ATK to a tile within 5. +3 if the target is on corruption.
- Grasping Rot — Movement — 2 — Push an enemy within 3 two tiles away from you.
- Cleanse — Utility — 1 — Remove corruption from a tile within 2.
- Withering Curse — Utility — 1 — An enemy within 4 takes 2 pierce damage at the start of each of its next 3 turns.
- Dark Pact — Recovery — 1 — Restore 4 + ATK + HPpts HP. Doubled if you're on or next to corruption.

Round all fractional values down unless noted.

---

## 9. Gamebreakers (ultimates)

**Break meter** (0–100): +10 when your Damage card hits a piece, +5 when you take damage, +15 when you open a cache, +20 to everyone when a ring closes. Each Gamebreaker has its own charge cost; using it spends that much. A player whose meter can afford their Gamebreaker has a visible glow on their piece.

### Vanguard
- **Iron Tide (80):** Pick a direction. Charge up to 6 tiles, stopping before the first piece or obstacle. A piece you stop at takes 4 + DEF + ATK and is knocked back 3.
- **Last Bastion (60):** Gain a shield of DEF×3 + 3. For 2 rounds, you can't be moved and you reflect half of the damage you take (pierce) to the attacker.
- **Earthshatter (100):** Raise all tiles in a 3×3 around you by 1 (max 2). All pieces in the 8 tiles around you take 2 + DEF×2 and are pushed 2.

### Striker
- **Thousand Cuts (60):** Your Damage cards cost 0 Energy for the rest of this turn.
- **Blitz Chain (80):** For the rest of this turn, each Damage card that hits adds a temporary 0-cost "Blitz Step" card to your hand (walk up to 2). Temporary cards vanish at end of turn.
- **Final Form (100):** For 2 rounds, gain ATK equal to your SPD.

### Marksman
- **Railpiercer (80):** Pick a direction. Deal 6 + ATK×2 pierce to every piece in that line across the entire board, ignoring pillars.
- **Skyfall Volley (100):** Mark a 3×3 area anywhere. At the start of your next turn, deal 8 + ATK×2 to every piece inside. The marker is visible to all.
- **Eagle's Perch (60):** Raise your tile to level 3. For 2 rounds, gain +2 range and your tile can't be entered by any movement.

### Phantom
- **Grand Swap (80):** Pick any two pieces on the board (2 picks). Swap their positions.
- **Mirror Legion (60):** Create 2 decoys on empty tiles within 2. They look identical to you, show your health bar, never take turns, and vanish when hit. AI cannot tell them apart from you.
- **Vanish (100):** Become invisible and untargetable until your next turn. Your next Damage card deals double.

### Lifebinder
- **Undying Pulse (100):** For 3 rounds, the first lethal hit leaves you at 1 HP and immediately heals 30% of max HP.
- **Siphon Field (80):** Now and at the start of your next turn, every enemy within 2 loses 2 + HPpts HP (pierce), and you heal the total.
- **Blood Tether (60):** Link to an enemy within 4 for 2 rounds. You heal for half of all damage it takes.

### Hexer
- **Collapse (100):** The next corruption ring closes immediately. The ring schedule restarts from now.
- **Blight Bloom (80):** Corrupt a 3×3 area anywhere (center 2×2 excluded).
- **Rot Embrace (60):** For 3 rounds, corruption heals you instead of hurting you, and every tile next to where you end your turn becomes corrupted.

---

## 10. Board, corruption, and loot

- 12×12 grid. Ring index = distance to the nearest edge (0–5).
- **Elevation:** generate natural-looking clusters of levels 0–2 (smoothed noise). The center 2×2 is always level 0 or 1 and pillar-free.
- **Pillars:** about 8 ruined pillars, blocking movement and line of sight, placed so no area is sealed off (verify connectivity with flood fill).
- **Spawns:** 8 players spread evenly around ring 1, never adjacent.
- **Corruption:** rings 1–3 are safe. Ring 0 closes at the start of round 4, then one more ring every 3 rounds, up to ring 4 (leaving the center 2×2). The round before a ring closes, its tiles show a pulsing warning. Cleansed tiles in already-closed rings get corrupted again when the next ring closes. Closed tiles destroy caches.
- **Caches:** about 10 on rings 0–3. Landing on one opens it: choose 1 of 3 — two cards (from your class + general pool) or a **Stat Shard** (+1 to a stat of your choice; HP shard adds +5 max HP and heals 5; shards ignore the 6-point cap). Cards go into your hand (or discard if hand is full).
- **Traps:** visible only to their owner (shown faintly). Trigger on any enemy landing on the tile, then disappear.

---

## 11. AI bots

Bots should play competently and differently by class. Suggested approach:

1. **Position value** for any tile: heavy penalty for corrupted or warning tiles and for rings about to close; bonus for caches; preference for the class's ideal distance from the nearest enemy (melee 1, Marksman 4, Hexer 3, others 2); small pull toward the center.
2. **Gamebreaker:** if affordable, score each option (damage dealt, kills, healing needed, escaping danger) and use it if the score clears a threshold.
3. **Act:** repeatedly score every affordable card × every legal target (expected damage after DEF with a big bonus for kills, healing weighted by missing HP, shields weighted by nearby enemies, movement by position-value gain, displacement by whether it pushes enemies toward corruption). Play the best while its score is positive.
4. **Move stance** when the best Act score is low: walk to the best-value tile within 2.
5. Bots never target their own decoys and treat enemy decoys as real.
6. A short delay between bot actions (about 400ms) so players can follow; add a fast-forward toggle (2×).

---

## 12. Graphics & UX Lead — visual direction

**Art direction:** "Ruined sky arena." A floating stone island arena under a deep twilight sky, warm stone tiles, cool moonlit rim light, and the corruption as a vivid magenta-violet rot with glowing veins eating inward. Readable, toy-like pieces with clear silhouettes, like premium miniatures on a board. Aim for the visual quality of a top-tier mobile tactics game.

**Scene:**
- Sky: vertical gradient canvas texture (deep indigo to dusky violet near the horizon) with faint stars; light exponential fog.
- Lighting: warm key directional light with soft shadows (PCFSoft, one shadow-casting light), cool hemisphere fill, cool rim light from behind. ACES filmic tone mapping, sRGB output.
- Arena: floating island base beneath the board with rough rock sides and hanging rock spikes; a few slowly drifting rock fragments around it.
- Tiles: beveled-looking stone (slightly inset top), subtle per-tile color variation, side faces darker. Height levels clearly readable.
- Corrupted tiles: dark violet top with a procedurally drawn glowing vein texture, emissive pulse, rising magenta motes (one shared particle system).
- Warning tiles: pulsing magenta outline/overlay.
- Pillars: broken ancient columns with chipped tops.
- Caches: small gilded chests with a soft glow sprite and gentle bob.
- Fake bloom with additive glow sprites (radial gradient canvas texture), since post-processing isn't available.

**Pieces:** see Section 6. Team-colored base rims so each of the 8 players is distinct. Active-turn piece has a pulsing ring under it. Shield shows as a faint translucent hex-sphere. Gamebreaker-ready pieces have a glowing aura.

**Animation and VFX** (all Promise-based so CORE awaits them):
- Walk: small hops tile to tile. Dash: fast slide with a motion trail. Teleport: dissolve out/in with particles. Push/pull: slide with a dust burst on collision.
- Melee hit: arc slash flash + impact particles + piece recoil. Ranged: glowing projectile on an arc or a beam for lines.
- Area attacks: tile flash in the pattern, staggered outward.
- Heal: green-gold rising sparks. Shield: hex-sphere pulse. Corruption damage: violet burst.
- Floating damage/heal numbers (DOM overlay, rising and fading). Brief screen shake on big hits and ring closes.
- Ring close: corruption sweeps across the ring tile by tile with a rumble shake.
- Death: piece shatters into fragments that fall off the board.
- Every Gamebreaker gets a distinct, showy effect (1–2 seconds), with a short banner announcing it.

**Camera:**
- Near-isometric perspective (narrow FOV), fitted so the full board fills the screen width in portrait, framed above the hand UI (use `setViewOffset`).
- One-finger drag rotates around the board; vertical drag tilts within limits; pinch zooms. Distinguish taps from drags (8px threshold). Raycast taps onto tiles and pieces.
- The camera gently eases toward the active piece each turn.

**HUD (portrait):**
- Top: round number, rounds until next ring closes, players alive; turn-order strip of 8 small class-colored portraits in SPD order with the active one highlighted and eliminated ones greyed.
- Health bars and names float above every piece (DOM overlay).
- Bottom: your hand as a fanned row of cards (cost gem, category color and icon, name, key number), Energy pips, a circular Gamebreaker button showing meter fill, and End Turn.
- Selecting a card lifts it and shows a detail panel with full live text and Cancel.
- Category colors: Movement cyan, Damage red, Utility gold, Recovery green.
- Readable typography: one distinctive display face for titles/numbers and one clean UI face, both from Google Fonts with fallbacks.
- Banners: "Your turn," "Ring closing next round," Gamebreaker callouts, eliminations.
- Short combat log (last 3 events) that can expand.
- Respect `prefers-reduced-motion` (reduce shake and particles).

**End screen:** placement ("Victory" or "Eliminated — 5th"), damage dealt, eliminations, caches opened, Gamebreakers used, and buttons for Play Again and Back to Loadout. If the player is eliminated early, offer Spectate (bots continue at fast speed) or Leave.

---

## 13. Build order and acceptance criteria

1. DATA + CORE + AI, headless. Pass the 200-match test with zero errors and reasonable class balance.
2. Loadout screen fully functional, including live numbers, deck rules, and presets.
3. Match HUD and card targeting flow, playable with basic visuals.
4. **Graphics pass** (Section 12): scene, pieces (all 18 variants), VFX, animation, camera, polish.
5. Final QA on a 390×844 portrait viewport: no overlapping UI, all touch targets reachable, no stuck turns, consistent 60fps feel.

Deliver the single HTML file plus a short note listing design decisions and any balance changes from this brief.
