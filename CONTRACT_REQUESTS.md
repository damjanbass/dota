# Contract change requests

Agents append requests here (what, why, proposed diff). Lead applies or rejects at each gate.

## Agent B (Game Data) — 2026-10-11

1. **HeroDef stat semantics (doc only).** `src/data` stores hero `hp`, `mana`, `hpRegen`, `manaRegen`, `armor` and `damageMin/Max` as **level-1 values including attribute bonuses** (e.g. Sniper hp 454 = 150 + 16 str × 19). `heroStatsAtLevel()` in `src/data/index.ts` derives other levels. Proposed diff: add to the `HeroDef` JSDoc in `src/core/types.ts`: `/** Stat fields are level-1 values including attribute bonuses; see heroStatsAtLevel(). */`
2. **UnitDef extra WC3 fields.** Needed by AI and sim: `attackBackswing`, `acquireRange` (auto-acquire), `castPoint`/`castBackswing` and `moveType`. They are kept locally for now in `src/data/extra.ts` (`UnitExtra`, `UNIT_EXTRAS[id]`). Proposed diff: add optional `attackBackswing?: number; acquireRange?: number;` to `UnitDef`.
3. **ItemDef passives.** `ItemDef` only has `active`. Crits, life steal, evasion, chain lightning and MKB bash are kept locally as `ITEM_PASSIVES: Record<itemId, abilityId[]>` in `src/data/items.ts`. Proposed diff: add `passives?: string[];` to `ItemDef`.
4. **Ability damage type.** `AbilityDef.values` is numbers only, so the damage type (physical / magical / pure, see `DamageType` in `sim.ts`) lives only in the descriptions and source strings. Proposed diff: add `damageType?: DamageType;` to `AbilityDef`.
5. **ItemDef charges.** Tango has 4 charges, the consumables have 1. Proposed diff: add `charges?: number;` to `ItemDef`. For now Tango's charges are in its ability `values.charges`.

### Lead decision (2026-10-11): B1–B5 applied
`src/core/types.ts` now has the HeroDef stat-semantics doc, `UnitDef.attackBackswing?` / `acquireRange?`, `ItemDef.passives?` / `charges?`, and `AbilityDef.damageType?`. `DamageType` moved to `types.ts` (re-exported from `sim.ts`). The local workarounds in `src/data` (`UNIT_EXTRAS`, `ITEM_PASSIVES`) stay valid; wave 2 may migrate them.

## C (FPS Feel) #1: Vite watcher ignores every file inside a worktree

**What:** `vite.config.ts` has `server.watch.ignored: ['**/.claude/**', ...]`. Every agent worktree lives under
`.claude/worktrees/<id>/`, so inside a worktree that glob matches *all* project files. The dev server never
invalidates its module cache: edits are not picked up until the server restarts. Because
`playwright.config.ts` uses `reuseExistingServer: true`, an e2e run can silently test stale code if a dev server
from an earlier edit is still running on that port.

**Why:** C hit this while iterating (screenshots didn't change after edits). Worked around it by restarting the
server before every check.

**Proposed diff** (`vite.config.ts`): ignore only the `.claude` folder next to the config, not any path containing `.claude`.

```diff
-import { defineConfig } from 'vitest/config';
+import { fileURLToPath } from 'node:url';
+import { defineConfig } from 'vitest/config';
+
+const claudeDir = fileURLToPath(new URL('./.claude/', import.meta.url));
 ...
-  server: { port, strictPort: true, watch: { ignored: ['**/.claude/**', '**/source-map/**'] } },
+  server: {
+    port,
+    strictPort: true,
+    watch: { ignored: [(p: string) => p.replaceAll('\\', '/').startsWith(claudeDir.replaceAll('\\', '/')), '**/source-map/**'] },
+  },
```

## C (FPS Feel) #2: optional `'player:zoom'` event

**What:** add `'player:zoom': { level: 0 | 1 | 2 }` to `GameEvents`.

**Why:** UI/audio (H) will want a scope sound and HUD change on zoom, and Take Aim (F) may react to it.
Right now they can poll `player.scope.zoomLevel` and `player.scope.isScoped`, which works, so this is a
convenience only. C does not emit it until it is accepted.

```diff
 export interface GameEvents extends Record<string, unknown> {
   'player:shot': { origin: Vec3; direction: Vec3; result: ShotResult };
+  'player:zoom': { level: 0 | 1 | 2 };
```

### Lead decision (2026-10-11): C1 and C2 applied
C1: `vite.config.ts` now ignores only `<root>/.claude/` and `<root>/source-map/` using a path-relative function, so HMR works inside worktrees. C2: `'player:zoom'` was added to `GameEvents`. Its emission gets wired at integration.
