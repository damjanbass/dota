# Contract change requests

Agents append requests here (what, why, proposed diff). Lead applies or rejects at each gate.

## Agent B (Game Data) — 2026-10-11

1. **HeroDef stat semantics (doc only).** `src/data` stores hero `hp`, `mana`, `hpRegen`, `manaRegen`, `armor` and `damageMin/Max` as **level-1 values including attribute bonuses** (e.g. Sniper hp 454 = 150 + 16 str × 19). `heroStatsAtLevel()` in `src/data/index.ts` derives other levels. Proposed diff: add to the `HeroDef` JSDoc in `src/core/types.ts`: `/** Stat fields are level-1 values including attribute bonuses; see heroStatsAtLevel(). */`
2. **UnitDef extra WC3 fields.** Needed by AI and sim: `attackBackswing`, `acquireRange` (auto-acquire), `castPoint`/`castBackswing` and `moveType`. They are kept locally for now in `src/data/extra.ts` (`UnitExtra`, `UNIT_EXTRAS[id]`). Proposed diff: add optional `attackBackswing?: number; acquireRange?: number;` to `UnitDef`.
3. **ItemDef passives.** `ItemDef` only has `active`. Crits, life steal, evasion, chain lightning and MKB bash are kept locally as `ITEM_PASSIVES: Record<itemId, abilityId[]>` in `src/data/items.ts`. Proposed diff: add `passives?: string[];` to `ItemDef`.
4. **Ability damage type.** `AbilityDef.values` is numbers only, so the damage type (physical / magical / pure, see `DamageType` in `sim.ts`) lives only in the descriptions and source strings. Proposed diff: add `damageType?: DamageType;` to `AbilityDef`.
5. **ItemDef charges.** Tango has 4 charges, the consumables have 1. Proposed diff: add `charges?: number;` to `ItemDef`. For now Tango's charges are in its ability `values.charges`.
