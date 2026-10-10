# src/data — values to verify

Almost everything in `src/data` was copied from the real **DotA v6.83d** map (`source-map/DotA v6.83d.w3x`).
I read its MPQ directly: `war3mapMisc.txt` (gameplay constants), `Units/*.slk` + `*Strings.txt` (object
data), `war3map.w3a` (ability level overrides) and `scripts/war3map.j` (the obfuscated map script). Source
strings name the exact rawcode, field or script function.

This file lists only the values that could not be confirmed from the map, or that rest on an
interpretation of WC3 engine semantics. Each entry gives the value used, why it is uncertain and the
best source found. Confidence: **H** = only a formality, **M** = plausible, needs a check, **L** = weak.

## Brief vs map discrepancies (the map wins)

| # | Topic | What the 6.83d map shows |
|---|---|---|
| D1 | The brief said 6.83 had no Bounty rune | The map spawns a **Bounty rune** (`I0RC`) every 2 minutes at the second rune spot (`war3map.j` CBO/FUO). It is in `tables.ts RUNES.bounty`. |
| D2 | Dragon Lance | It does not exist in 6.83d (it was added in Dota 2 7.x), so I left it out. |
| D3 | Shadow Blade / Daedalus / Morbid Mask | In DotA 1 these are **Lothar's Edge**, **Buriza-do Kyanon** and **Mask of Death**. The data uses the DotA names. |
| D4 | Dota 2 "6.79" values | The Dota 2 port of 6.79 lists Take Aim as 80/160/240/320 and Roshan respawn as 8–11 min random. The 6.83d map has **100/200/300/400** (`R005`) and a fixed **600 s** (`FJ0=600`). The map values are used. |

## Uncertain values

| # | Value used | Where | Why uncertain | Best source | Conf. |
|---|---|---|---|---|---|
| 1 | Starting gold **625** | `tables.ts GOLD.startingGold` | The 6.83d script never sets the initial gold, so it comes from engine or map settings I couldn't read. The random-hero bonus is also unknown. | Liquipedia *Archive:Version 6.79* (Dota 2 port): "Starting gold increased from 603 to 625", "Random gold bonus reduced by 50". | M |
| 2 | Damage table **Spells** row: hero 0.70, divine 0.5, normal 1.0 | `tables.ts DAMAGE_TABLE.spells` | The map does not override this row, so it uses the WC3 default. The hero value conflicts with the usual "DotA heroes have 25% magic resistance". Divine and normal armor are not on the Hive chart. | classic.hiveworkshop.com *armorandweapontypes* (TFT chart: Spells vs Hero 70%); warcraft.wiki.gg (Divine takes 50% from spells). | M |
| 3 | Damage table **Hero** row: normal armor 1.0, divine 0.05 | `tables.ts DAMAGE_TABLE.hero` | WC3 default, not overridden. The Hive TFT chart has no Normal-armor or Divine column. | Hive TFT chart; warcraft.wiki.gg ("Divine takes 5% from all but Chaos"). | M |
| 4 | Hero `magicResistance` **0.25** (all heroes) | hero files, `HERO_MAGIC_RESISTANCE` | DotA has no single magic-resistance stat. Spell damage depends on the attack type each trigger uses: `ATTACK_TYPE_NORMAL` (= Spells, 0.70 vs hero), `ATTACK_TYPE_MAGIC` (0.75) or `ATTACK_TYPE_HERO` + `DAMAGE_TYPE_MAGIC` (1.0, e.g. Meat Hook). 0.25 matches the map's Magic-row override and the Dota 2 port. | 6.83d `war3mapMisc.txt` DamageBonusMagic; `war3map.j` P6I. | M |
| 5 | Armor constant **0.06** and negative formula 2 − 0.94^(−a) | `tables.ts ARMOR` | `DefenseArmor` is not overridden in `war3mapMisc.txt`, so it is the WC3 default. | Hive *armorandweapontypes* (formulas plus 1 armor ≈ 5.7%, −10 armor = +46.1%). | H |
| 6 | Every **`height`** (83 values: 6 heroes + 77 units) | `units.ts`, `sniper.ts`, `heroes/*` | FPS hitbox estimates. WC3 has no gameplay height and I can't read the model bounds (no Blizzard models). | None. Values were chosen from model type and scale (`modelScale`, `launchZ`/`impactZ` are in `UNIT_EXTRAS`). | L |
| 7 | Fountain aura: **2% max HP/s, 2% max mana/s, +7 mana/s**, radius 825 | `unitAbilities.ts FOUNTAIN_REGEN_AURA` | Read from WC3 ability codes: `ACnr` (Aoar, 0.02, percent), `ANre` (Aarm, 0.02, percent), `A0VL` (Aarm, 7, flat). Per-second and percent semantics are WC3 knowledge, not tested in game. | 6.83d AbilityData.slk. | M |
| 8 | Roshan **75% spell damage reduction** | `ROSHAN.magicResistance`, `roshan_spell_resistance` | `A0PW` is AIsr with DataB 0.75. I am reading that as "75% less spell damage", by analogy with Runed Bracers. | 6.83d AbilityData.slk. | M |
| 9 | Roshan growth **+600 HP, +12 damage per 5 min**, +0.5 armor per level | `tables.ts ROSHAN_RULES` | Upgrade `R00F` has rhpx 600 and ratx 12. Effects 1 and 4 are blank (20 and 0.25), so they are ignored. The level is set every 300 s from the horn (B8O). The first-spawn level (NQO sets none) is unclear. | 6.83d UpgradeData.slk R00F; `war3map.j` B8O/BEO/NQO; A142 (+w3a). | M |
| 10 | Towers attack with **weapon 2** (siege 100–120 etc.) | `units.ts` towers | Depends on the WC3 `weapsOn` bitmask (1 = weapon 1, 2 = weapon 2, 3 = both). Towers have weapsOn=2. If the meaning were different, T1 would be weapon 1 (normal type, same damage). | 6.83d UnitWeapons.slk. | M |
| 11 | Neutral camp **type labels** (small ×2, medium ×4, large ×4, ancient ×2) | `units.ts NEUTRAL_CAMPS` | The map only defines 12 camp rects, each with a spawn-group list. The small/medium/large names are inferred from the groups (they match Dota 2 6.83 camps). Ancients are certain. | `war3map.j` P3O and spawn functions. | M |
| 12 | Early-lane speed: lane marker 2 = **top** | `tables.ts CREEP_WAVES.earlyLaneSpeed` | The script uses lane markers 2/3/4. 2 = top is inferred from "lanes meet closer to the offlane tower". | `war3map.j` SPO/SZO/SVO/SSO; Liquipedia 6.79 port note. | M |
| 13 | TP Scroll **castPoint 0** | `sniper.ts ITEM_TPSCROLL_ABILITY` | The cast point for item abilities is not in the item data. | — | L |
| 14 | Headshot slow: **100% move slow only** | `sniper.ts SNIPER_HEADSHOT` | `A2YL` (Aasl) has DataA −1 and DataB −1, so attack speed may also be slowed 100%. The tooltip only says "slows by 100%". | 6.83d A2YK/A2YL, A03S Ubertip. | M |
| 15 | Viper Strike **castTime 1** | `heroes/viper.ts` | The WC3 `Cast` field is 1 s. Unclear whether it really delays the strike in play. | 6.83d A080. | M |
| 16 | Nethertoxin HP bands | `heroes/viper.ts` | Only min/max from the tooltip (2.5→40 etc.). The HP thresholds live in the script and were not extracted. | 6.83d A1A3 Ubertip. | L |
| 17 | Requiem slow / damage-reduction values; Necromastery souls per **hero** kill | `heroes/shadowFiend.ts` | Line count = souls/2 and damage per line are confirmed. Slow amounts and the hero-kill soul gain (the script hints +12) were not extracted. | `war3map.j` QN4/U34; A29J/A0BR tooltips. | L |
| 18 | Flesh Heap "nearby" radius | `heroes/pudge.ts` | Not in the tooltip, not extracted. | A06D Ubertip. | L |
| 19 | Mjollnir Static Charge **buff duration** | `items.ts item_mjollnir_static_charge` | The tooltip has no duration and it was not extracted. | I0BE Ubertip, A0JL. | L |
| 20 | Buriza recipe **1000** | `items.ts BURIZA_RECIPE` | The registry cost (FU0) says 1200, but the shop unit `h03D` costs 1000 and 2150 + 2400 + 1000 = 5550 = Buriza's cost. | 6.83d `war3map.j` registry; UnitBalance h03D. | M |
| 21 | Illusion rune: illusions **take +300% damage**, deal 35% | `tables.ts RUNES.powerRunes.illusion` | The tooltip says "take 300% more damage". It is unclear whether that means ×3 or ×4 incoming damage. | 6.83d I007 Description. | M |
| 22 | Regeneration rune: **3000 HP / 2000 mana total over 30 s** | `tables.ts RUNES` | AIrg DataA/DataB read as totals, which matches the salve (400 over 10 s). Numbers are large but consistent with "high regen". | 6.83d AIsl. | M |
| 23 | Buildings give **25 XP** (unit level 1) | `units.ts` tower/barracks/ancient `bountyXp` | The script's XP path (ARO) also handles structures, and `BuildingKillsGiveExp=1`. Not checked in game. | `war3map.j` ARO/ALO/SQI. | M |
| 24 | Creep **call-for-help aggro radius** | `tables.ts AGGRO` | This is WC3 engine behaviour (MiscGame `CallForHelp`). DotA does not override it, and I could not find the default value. | — | L |
| 25 | Bounty rune minutes counted from **map start**, not the horn | `tables.ts RUNES.bounty` | FUO uses `TimerGetElapsed(M)/60`. M starts at map init, so pre-game time is included. The exact pre-game length depends on mode selection. | `war3map.j` FUO, HA1. | M |
| 26 | Roshan Slam **hero duration 2 s** at levels 4–15 | `unitAbilities.ts ROSHAN_SLAM` | Levels 1–3 have HeroDur 2. I did not dump the w3a overrides for HeroDur at higher levels (Dur 4 is confirmed for all). | 6.83d ACtc + w3a. | M |
| 27 | Day/dawn/dusk hours **6:00 / 18:00** | `tables.ts DAY_NIGHT` | WC3 default dawn and dusk, not overridden. Cycle length (DayLength 300 × scale 0.625 → 480 s) and the 06:00 start are from the map. | `war3mapMisc.txt`, `war3map.j` IU2. | H |
| 28 | Healing Salve **cast range** | `items.ts item_healing_salve` | `AIpr` has no Rng, so 0 is stored. The real cast range is unknown. | 6.83d AIpr. | L |

**Total: 28 uncertain entries** (#6 groups 83 height estimates) plus 4 brief/map discrepancies.
