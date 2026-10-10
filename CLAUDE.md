# DotA Sniper FPS — project rules (read fully before editing)

This is the WC3 **DotA Allstars v6.83d** map (Frozen Throne, not Dota 2) rebuilt as a browser first-person shooter. The only playable hero is Sniper (Kardel Sharpeye).
- Controls: WASD to move, mouse to look, LMB to shoot, RMB/E to scope (Take Aim).
- Abilities: Q Shrapnel, R Assassinate, F Town Portal Scroll. Headshot is a passive that triggers on real headshots.
- Full plan: `C:\Users\PC\.claude\plans\act-as-the-best-serene-cat.md`.

## Stack and commands
Vite 8, TypeScript 7 (strict), three r186, Vitest 4, Playwright. No React. UI is a plain DOM overlay in `#ui`.
- `npm run dev`: dev server. `?scene=preview|world|fps` picks a dev scene (see `src/main.ts`).
- `npm run typecheck`, `npm test` (Vitest), `npm run e2e` (Playwright smoke + your own specs).
- **Parallel agents must set their own port**: `PORT=<your port> npm run e2e` (bash). Never use 5173 from a worktree.
- `npm run extract`: `.w3x` → `public/data/` (agent A).
- The source map lives at `D:\Projekti Vibe Code\Dota\source-map\` (gitignored, absolute path, not present in worktrees).

## Hard contracts (owned by Lead, read-only for agents)
`src/core/*` (types, map, coords, config, loop, events, rng, scene, mockMap), `src/main.ts`, `src/game/*`, `tests/e2e/smoke.spec.ts`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, this file.
- If you need a contract change, append it to `CONTRACT_REQUESTS.md` (what, why, exact proposed diff). Then work around it locally, e.g. with a local type that extends the contract. Do not edit the contract.
- **Units**: everything is in WC3 units (1 unit ≈ 1 inch), seconds and radians.
- **Axes**: X = east, Y = north, Z = up. Three.js conversion happens ONLY at the render boundary via `src/core/coords.ts` (`three = (x, z, -y)`).
- **Ranges**: data stores unscaled DotA ranges. Runtime multiplies them with `scaledRange()` (`RANGE_SCALE`). Move speeds and map distances are never scaled.
- **Map**: consume it only through `LoadedMap` plus the query helpers in `src/core/map.ts`. Everything must work on `createMockMap()` AND on the real extracted map.
- **Sim and render**: the sim runs fixed at 30 Hz (`core/loop.ts`) and must be deterministic: use `createRng`, never `Math.random`, in sim code. Render code reads sim state and never writes it.

## Ownership (edit ONLY your folders, plus tests named after your area)
| Area | Agent | Owns |
|---|---|---|
| Map pipeline | A | `tools/`, `public/data/`, `tests/unit/extract*.test.ts` |
| Game data | B | `src/data/`, `tests/unit/data*.test.ts` |
| FPS feel | C | `src/player/` (except `abilities/`), `tests/unit/player*.test.ts`, `tests/e2e/player*.spec.ts` |
| World art | D | `src/world/`, `public/assets/`, `tests/e2e/world*.spec.ts` |
| Simulation | E | `src/sim/` |
| Sniper kit | F | `src/player/abilities/` |
| Nav + AI | G | `src/nav/`, `src/ai/` |
| UI + audio | H | `src/ui/`, `src/audio/` |

`package.json` and `package-lock.json`: you may `npm install` a dependency only when it clearly beats roughly 20 lines of your own code. Say so in your report. Lead resolves lockfile merges.

## Code style
- TypeScript strict. Named exports only, no default exports. async/await, no `.then` chains.
- Small modules. Comments only where intent isn't obvious.
- Plain classes are fine for stateful systems. Keep pure math in functions so Vitest can cover it.
- Performance: InstancedMesh for anything repeated, no per-frame allocations in hot loops, dispose GPU resources.

## Legal and data honesty
- **No Blizzard assets**: no MDX/BLP models or textures and no WC3 sounds. Art is either our own (procedural or hand-built) or CC0. Every external asset gets a line in `public/assets/CREDITS.md` (name, author, license, URL).
- **Never invent DotA numbers.** Every gameplay value in `src/data` carries a `source` note. Anything unconfirmed goes in `src/data/VERIFY.md`.

## Finishing a task (agents)
1. `npm run typecheck`, `npm test` and `PORT=<port> npm run e2e` must all pass.
2. Commit on your worktree branch (local only, **never push**). Message: `<area>: <summary>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. Report back with: what's done, what's not, any contract requests, the dependencies you added, and screenshot paths.
