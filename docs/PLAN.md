# DotA Allstars (WC3: The Frozen Throne, v6.83d) as a first-person Sniper shooter

> **Status (2026-10-11):** Phase 0, wave 1 (A–D) and Gate 1 are done and on `main`. Wave 2 (E–H) is in progress on the `wave2/*` branches. See [`HANDOFF.md`](HANDOFF.md) for exact status and next steps.
>
> Below is the original approved plan. Paths like `D:\Projekti Vibe Code\Dota` refer to the original machine; in the repo everything is relative to the root.

## Context
Damjan wants the original Warcraft III DotA Allstars map rebuilt as a playable first-person shooter. You play one hero, Sniper (Kardel Sharpeye), with a CS 1.6 feel: WASD to move, the mouse to aim and shoot, and Q/E/R/F for abilities. The layout should match the real map. The project folder `D:\Projekti Vibe Code\Dota` is empty, and Node 25 and npm 11 are installed. The work should be split across parallel agents to finish faster.

**Locked decisions (from Q&A)**
- Browser game built with **Vite + TypeScript (strict) + Three.js**. It runs in Chrome with nothing to install, and agents can build, run and screenshot-test it themselves.
- **Exact layout pulled from Damjan's own `DotA v6.83d.w3x`**. Only geometry and placement data is used: terrain heights, cliffs, water, pathing, trees and unit positions. No Blizzard models, textures or sounds are used. The art is original low-poly work styled after WC3 (Ashenvale for Sentinel, blight/Northrend for Scourge) plus CC0 assets.
- **Game mode: PvE with AI heroes.** That means creeps, towers, barracks, neutrals, Roshan and runes, plus AI enemy heroes and optional allied bots.
- **Keys:** Q Shrapnel, E Take Aim (scope), R Assassinate, F Town Portal Scroll. Headshot is passive and fires on real FPS headshots.

**Pushback, built into the plan:**
- "Exactly the same" applies to layout and rules. The visuals can't be Blizzard's assets for legal reasons, and those assets aren't in the map file anyway.
- Real DotA attack ranges are very short in FPS terms (550 ≈ 14 m), so the plan adds one global `RANGE_SCALE` multiplier. It keeps DotA's relative balance (Sniper with Take Aim still outranges towers) while making fights feel like a shooter.

## Game analysis → FPS translation
| DotA 6.83d element | FPS implementation |
|---|---|
| Map: Sentinel (bottom-left, World Tree) vs Scourge (top-right, Frozen Throne). Three lanes, a diagonal river, jungles, 2 river rune spots, Roshan pit, 11 towers and 6 barracks per side, fountains, base, secret and side shops | Generated from the `.w3x` data, so terrain, every tree, cliffs, river and building positions match the real map |
| Unit scale (WC3 units) | **1 WC3 unit ≈ 1 inch, which is CS 1.6 scale.** Eye height 64. Sniper's move speed of 290 ends up close to CS run speed (250). The sim uses WC3 units directly, so there's no conversion layer |
| Right-click attack, BAT 1.7, damage roll vs armor | Hitscan rifle. The time between shots equals DotA's attack cooldown, which gives a bolt-action rhythm. Damage uses DotA's base damage, armor formula and attack-type/armor-type table |
| Headshot (passive % proc: bonus damage + mini-stun) | A real headshot is a **guaranteed** proc. Body shots still roll DotA's chance |
| Take Aim (passive +range) | **E / RMB = scope toggle** (2 zoom levels, AWP-style). While scoped you get the Take Aim range bonus for your skill level and slower movement |
| Shrapnel (charges, AoE slow + DoT) | **Q**: the AoE preview follows the ground point under the crosshair. Quick-cast is the default, with a setting for click-to-confirm |
| Assassinate (hero-only, long range, aim time) | **R**: keep the crosshair on an enemy hero for the cast time. It then fires a homing round with a mini-stun |
| Town Portal Scroll | **F**: opens the tactical map. Click an allied structure, then a 3 s channel that is cancelled if you take damage. It is bought in the shop like in DotA |
| Last hit / deny, gold, XP, levels 1–25, skill points | Same rules. You can only shoot allied creeps to deny them when they are under 50% HP. Skills are levelled with Ctrl+Q/E/R, plus Ctrl+G for Headshot |
| Fog of war, day/night vision | Enemies render, and show on the minimap, only when a Sentinel unit can see them (vision radius plus line-of-sight that trees block). Night lighting and night vision radii apply |
| Creep waves, tower rules, barracks, mega creeps, Roshan, Aegis, runes, buyback | Ported 1:1 from the 6.83d data spec (see agent B) |
| Enemy heroes | AI bots. The proposed starting roster is 5 simple-kit heroes: Pudge, Lion, Viper, Shadow Fiend, Lich. In DotA any team can pick any hero, so allied bots can reuse the same kits |

Global `RANGE_SCALE` (default 2.0, tuned in playtests) multiplies **all** attack, spell, aggro and vision ranges equally. Map distances are never scaled.

## Architecture
```
/ (D:\Projekti Vibe Code\Dota)
  source-map/DotA v6.83d.w3x   # Damjan's file, gitignored, never shipped
  tools/extract-map/           # .w3x → public/data/*
  public/data/                 # map.json, height.bin, pathing.bin, minimap.png (generated)
  public/assets/               # CC0 glTF models + audio (licenses in CREDITS.md)
  src/
    core/    loop.ts (30 Hz fixed sim + interpolated render), events.ts, types.ts, config.ts (RANGE_SCALE etc.), rng.ts
    data/    sniper.ts, heroes/*.ts, units.ts (creeps/towers/rax/ancients/neutrals/Roshan), items.ts, tables.ts (XP, gold, armor, attack types)
    world/   terrain.ts (chunked heightmap + cliff walls + tile splat), water.ts, trees.ts (InstancedMesh), buildings.ts, sky.ts, daynight.ts
    sim/     units.ts, combat.ts, waves.ts, towers.ts, neutrals.ts, roshan.ts, runes.ts, economy.ts, vision.ts, match.ts (win/lose)
    nav/     grid.ts (from wpm + tree footprints), astar.ts, flowfield.ts
    ai/      creep.ts, heroAI/ (state machine: lane / farm / harass / retreat / gank / push)
    player/  controller.ts (CS-style accel/friction/air-strafe/jump), weapon.ts, viewmodel.ts, hitbox.ts, abilities/{shrapnel,takeAim,assassinate,headshot,tp}.ts
    ui/      hud.ts, minimap.ts, scoreboard.ts (Tab), shop.ts (B), menu.ts, settings.ts (plain DOM/CSS overlay, no React)
    audio/   audio.ts
  tests/     unit (Vitest), e2e (Playwright screenshots + console-error + FPS budget)
```
- **Map extraction:** first try the parsers in `mdx-m3-viewer` (npm). They already read MPQ, w3e, doo, Units.doo and w3u, and using them keeps the repo in one language. If they fail on the protected archive, fall back to Python with `mpyq` and hand-written parsers for `war3map.w3e`, `war3map.wpm`, `war3map.doo` and `war3mapUnits.doo` (the formats are publicly documented). If both fail, Damjan exports those 4 files with Ladik's MPQ Editor.
- **No physics library.** Collision uses the pathing grid, building/tree cylinders and the heightmap for ground height. Hits are raycasts against unit capsules plus head spheres. Tree trunks block shots and canopies block vision.
- **Sim/render split.** The sim is deterministic and headless-testable, and rendering reads sim state. Ranged creep and tower projectiles home on their target like in WC3.

## Agent orchestration
**Lead (main session, me):** Phase 0 scaffold and the **contracts**: `core/types.ts`, the `MapData` JSON schema, the `Unit`/`Ability`/event interfaces and the folder ownership table. I also merge branches, resolve conflicts and run the gate after each wave. Agents run in parallel, **each in its own git worktree** and in the background, and touch **only the folders they own**. Contract changes go through me via `CONTRACT_REQUESTS.md`.

> Worktrees need git. **Approving this plan means permission to `git init` and make local-only commits and branches. Nothing is ever pushed.**

**Phase 0, Lead, sequential.** Vite+TS strict+three, Vitest and Playwright set up. Contracts, mock `map.json` (flat test map) so wave-1 agents aren't blocked. Damjan drops the `.w3x` into `source-map/`.

**Wave 1, 4 agents in parallel → Milestone 1 "Walk the map"**
| Agent | Owns | Delivers | Acceptance |
|---|---|---|---|
| A Map Pipeline | `tools/`, `public/data/` | `npm run extract` → heightmap, cliffs, water, pathing, trees, placed units classified by w3u name (towers T1–T4, rax, ancients, fountains, shops), lane waypoints, neutral camp spots, rune spots, Roshan, baked minimap | Prints counts (11 towers + 6 rax + 1 ancient per side, etc.). A top-down debug render matches the in-game minimap |
| B Game Data | `src/data/` | All 6.83d values: Sniper stats/levels/abilities, creep/tower/rax/ancient/neutral/Roshan stats, wave timing and composition, XP/gold/bounty tables, armor and attack-type table, runes, TP and core items, 5 AI hero kits. Every value has a source comment. Overrides are read from the map's w3u/j where possible | `VERIFY.md` lists every value it couldn't confirm, and nothing is made up |
| C FPS Feel | `src/player/` (minus abilities) | Pointer lock, CS 1.6 movement, rifle viewmodel, recoil, bolt cycle, scope overlay, hitscan with head/body hitboxes, test dummies | Playwright: move, shoot, headshot registers. Manual feel check by Damjan |
| D World Art | `src/world/`, `public/assets/` | Chunked terrain with tile splatting (Ashenvale vs blight), river water, instanced trees per tileset, procedural towers/rax/Ancients/fountain/shops, CC0 animated creep/hero models, lighting, fog, day/night | 60+ FPS at 1080p on the full map. Screenshots of both bases, mid, river and Roshan |

**Gate 1 (Lead):** merge, then walk from the Sentinel fountain to the Scourge base on the real map with collision.

**Wave 2, 4 agents in parallel → Milestone 2 "Lane" + Milestone 3 "Full match"**
| Agent | Owns | Delivers |
|---|---|---|
| E Simulation | `src/sim/` | Units, combat (armor and attack types), creep waves on lane waypoints, DotA creep aggro (hero-on-hero draws aggro), tower target priority, tower invulnerability order, barracks → mega creeps, gold/XP split, last hit/deny, death/respawn/buyback, runes, win/lose |
| F Sniper Kit | `src/player/abilities/` | Q/E/R/F, Headshot, mana, cooldowns, charges, levelling 1–25, skill points |
| G Nav + AI | `src/nav/`, `src/ai/` | Grid A* plus flow fields per lane, creep AI, neutral camps (spawn timing, leash), Roshan + Aegis, hero AI with 3 difficulties, the 5 hero kits implemented |
| H UI + Audio | `src/ui/`, `src/audio/` | CS-style HUD + DotA ability bar (cooldowns, levels, mana), minimap with team vision, Tab scoreboard (K/D/LH/DN), shop, respawn screen, main menu (allies 0–4, enemies 1–5, difficulty), settings (sensitivity, FOV, quick-cast), CC0 or jsfxr sounds |

**Gate 2 (Lead):** full match from start to destroying the Frozen Throne against AI.

**Wave 3, 2 agents → Milestone 4 "Polish"**
- **QA agent:** Playwright e2e suite, perf profiling, unit tests for formulas and rules, `/code-review`.
- **Balance agent:** tunes `RANGE_SCALE`, AI difficulty and TP timing from scripted bot-vs-bot runs.

The Lead fixes integration issues and Damjan does the final playtest.

Each agent prompt contains: the goal, the folders it owns, the read-only contracts, its acceptance commands, and a ban on editing outside its own folders.

## Verification
- `npm run extract` → counts and debug render of the real map. `npm run dev` → play in Chrome.
- `npm test` (Vitest) covers:
  - the damage/armor formula
  - attack-type multipliers
  - XP/gold tables
  - wave timing
  - tower targeting
  - creep aggro
  - Shrapnel, Assassinate and Headshot math
  - the TP channel being cancelled by damage
- `npm run e2e` (Playwright, headless Chrome):
  - boots the game with no console errors
  - takes screenshots at fountain, mid T1, river, Roshan and the Scourge base
  - checks the frame time budget with about 200 units on screen
- Manual checklist:
  - last-hit and deny in mid
  - Shrapnel slows a wave
  - Assassinate kills a low-HP AI hero
  - TP to a tower
  - kill Roshan and pick up the Aegis
  - push and destroy the Frozen Throne → victory screen

## Risks
- The 6.83d map is protected, so the MPQ may not parse. Fallback chain above.
- Some exact balance numbers can't be confirmed from public sources. They're flagged in `VERIFY.md` instead of guessed.
- AI hero quality is the biggest scope risk. Mitigation: get 1v1 mid against Shadow Fiend working first, then scale up to 5v5.
