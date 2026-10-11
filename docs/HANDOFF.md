# Handoff: where the project stands and how to continue

*Last updated 2026-10-11 by Damjan (with Claude Code).*

This repo rebuilds the Warcraft III **DotA Allstars v6.83d** map (Frozen Throne, **not Dota 2**) as a browser first-person shooter. You play Sniper with CS 1.6 controls. Read [`PLAN.md`](PLAN.md) for the design and [`../CLAUDE.md`](../CLAUDE.md) for the code rules before touching anything.

## 1. Quick start

```bash
git clone https://github.com/damjanbass/dota.git && cd dota
npm install
npx playwright install chromium     # only needed for e2e tests
npm run dev                         # → http://localhost:5173
```

- **Controls:**
  - Click to lock the mouse. WASD to move, Space to jump, Shift to walk.
  - LMB shoots. RMB or E scopes (2 zoom levels).
  - F3 shows debug stats. Esc releases the mouse.
- **Checks:** `npm run typecheck`, `npm test` (Vitest) and `npm run e2e` (Playwright).
- **Dev scenes:** `?scene=game` (default), `preview` (top-down map), `world` (free-fly camera, `?view=sentinel_base|scourge_base|mid|river|roshan|showcase`), `fps` (firing range).
- On a wave-2 branch, the scenes `sim`, `kit`, `ai` and `ui` also work.

## 2. Status

| Phase | What | Status | Where |
|---|---|---|---|
| 0 | Scaffold, contracts (`src/core`), mock map, tests | ✅ done | `main` |
| 1A | Real map extracted from `DotA v6.83d.w3x` | ✅ merged | `tools/extract-map`, `public/data` |
| 1B | 6.83d game data, read from the map file itself | ✅ merged | `src/data` (open items in `src/data/VERIFY.md`) |
| 1C | CS 1.6 movement, bolt-action rifle, AWP scope, hitboxes | ✅ merged | `src/player` |
| 1D | WC3-style world: terrain, cliffs, water, trees, buildings, unit models, day/night | ✅ merged | `src/world` |
| Gate 1 | Real world + player + building collision; e2e walk from fountain to fountain | ✅ passing | `src/game`, `tests/e2e/game.spec.ts` |
| 2E | Simulation: creeps, towers, combat, economy, levels, runes, neutrals, vision, shops | 🟡 192/193 tests pass | branch `wave2/sim` |
| 2F | Sniper kit: Q Shrapnel, Headshot, E Take Aim, R Assassinate, F Town Portal | 🟡 121/121 tests pass; still on a fake sim | branch `wave2/kit` |
| 2G | Navigation (A*/HPA*), bot AI, the 5 enemy hero kits, Roshan and neutral abilities | 🟡 128/128 tests pass; **bot controller not written** | branch `wave2/ai` |
| 2H | CS-style HUD, minimap with fog, shop, scoreboard, menus, procedural audio | 🟡 128/128 tests pass; e2e not run yet | branch `wave2/ui` |
| Gate 2 | Full match against bots until the Frozen Throne falls | ⬜ todo | `src/game/game.ts` |
| 3 | QA and balance (RANGE_SCALE, AI difficulty) | ⬜ todo | |

- `main` holds about 95 unit tests, the smoke e2e for every scene, and the Gate 1 walk test.
- The wave-2 branches only touch their own folders, so they merge into `main` without conflicts. All four typecheck.

## 3. Next steps, in order

1. **`wave2/sim`, finish it.** One test fails: `tests/unit/sim.combat.test.ts` → *creep aggro … give up a chase*. The work in progress is the DotA creep-aggro rule in `src/sim/combat.ts`. Fix it, run `npm test`, merge to `main`.
2. **`wave2/kit`, merge it.** Then switch its dev scene and tests from `testing/fakeSim.ts` to the real `createSim`.
3. **`wave2/ai`, write the bot controller.**
   - Needed: `src/ai/index.ts` exporting `createBotController(sim, unitId, heroId, difficulty)` and `setupBots(sim)`. `setupBots` registers brains via `sim.registerBrain` and the path finder via `sim.setPathFinder(createPathFinder(...))`.
   - The parts already exist: `perception.ts`, `tactics.ts`, `lanes.ts`, `builds.ts`, `aim.ts`, `difficulty.ts`.
   - Abilities are done: `registerHeroAbilities(sim)` and `registerNeutralAbilities(sim)` in `src/ai/abilities`.
4. **`wave2/ui`, finish it.** Run `npm run e2e` (spec `tests/e2e/ui.spec.ts`), review the screenshots, merge.
5. **Gate 2, wire everything in `src/game/game.ts`.** Checklist:
   - **Menu.** `createMenus(ui).showMainMenu()` → `MatchConfig` → `createSim(map, config)`.
   - **Abilities.** `registerSniperAbilities(sim)`, `registerHeroAbilities(sim)`, `registerNeutralAbilities(sim)`, `setupBots(sim)`.
   - **Player.**
     - Set `targets: () => hittablesFor(sim, 'sentinel')` on `createPlayer`.
     - After `player.update(dt)`, call `sim.setUnitPosition(sim.player().id, player.controller.position, player.controller.yaw)`.
     - Then call `sim.step(dt)`.
     - Feed back `player.stats` (`moveSpeed`, `fireInterval`, `range`) from `sim.stats(heroId)`, and `player.stunned` from the stun buffs.
   - **Kit, HUD, audio.** `createSniperKit({ sim, player, scene, camera, ui, events, map })`, `createHud({...})`, `createAudio(events, player)`. The sim must use the same `EventBus` as the player: pass `events` through.
   - **Rendering.** `createUnitRenderer` and `createProjectileRenderer` are already in `src/game/`. On `building:destroyed`, call `world.setBuildingVisible(entityId, false)` and `colliders.remove(entityId)`.
   - **Time of day.** Each frame, call `world.setTimeOfDay(...)` from `sim.timeOfDay`.
6. **Wave 3.** QA pass (e2e of a full match, performance with about 200 units), then balance: tune `RANGE_SCALE` in `src/core/config.ts` and the AI difficulty.

## 4. Things to know

- **The source map is not in the repo.** `source-map/` is gitignored. The extracted data in `public/data/` *is* committed, so the game runs without it. To re-run `npm run extract`, put your own `DotA v6.83d.w3x` in `source-map/`.
- **Scale.** 1 WC3 unit ≈ 1 inch (CS 1.6 scale). The eye is 64 units up. Sniper moves at 290, close to CS run speed.
- **Heights are absolute.** The real map's ground sits around Z = 1024, not 0.
- **Ranges.** All DotA ranges are multiplied by `RANGE_SCALE` (2.0). Map distances and move speeds are not scaled.
- **The map file is the source of truth for rules and numbers**, not wikis. Some examples:
  - 6.83d *does* have a Bounty rune.
  - There is no Dragon Lance.
  - Items use DotA 1 names (Buriza-do Kyanon, Lothar's Edge).
- **Open data questions** are listed in `src/data/VERIFY.md`. The biggest is starting gold: 625 is a Dota 2 port value.
- **No Blizzard assets.** All art and sound is procedural, made by our own code. Credits are in `public/assets/CREDITS.md`.
- **Known polish items:**
  - Cliff faces read as smooth rock, not crisp WC3 cliffs.
  - Ashenvale trunks are a bit dark, and the Frozen Throne glow is strong.
  - The unit models are first-pass.
  - The first-person viewmodel's right hand is mostly off-screen.
  - Sniper has no third-person model; an allied-bot Sniper would render as a kobold.
  - Hitbox heights are estimates.

## 5. Working with Claude Code (how this was built)

- **Structure.** A "Lead" session owns the contracts (`src/core`, `src/game`, configs). Parallel agents each own one folder and work in their own git worktree (see the ownership table in `CLAUDE.md`).
- **Contract changes** go through `CONTRACT_REQUESTS.md`. Agents never edit `src/core` directly.
- **Ports.** Each parallel agent runs e2e on its own port: `PORT=518x npm run e2e`.
- **Usage limits.** Four or five parallel Opus agents hit the claude.ai session usage limit within about 1–2 hours. Run **two agents at a time**, and have them commit WIP after every chunk. A worktree with no commits gets cleaned up automatically.
- **Workflow.** Each agent finishes with typecheck + unit + e2e passing and a local commit. The Lead merges with `--no-ff` and runs the gate test.
