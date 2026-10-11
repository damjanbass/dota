# Asset credits

No external art assets are used by the world renderer (`src/world/`).

Everything is generated at runtime by our own code (original work, no Blizzard assets):

| Asset | Source | License |
|---|---|---|
| Ground textures (19 hand-painted-style layers: grass, dirt, rock, snow, ice, blight, cliff rock, ...) | `src/world/terrainTextures.ts` (procedural canvas painting) | Project code |
| Water normal map, noise textures | `src/world/water.ts`, `src/world/terrainTextures.ts` (procedural) | Project code |
| Trees, doodads, buildings, Roshan pit | `src/world/treeModels.ts`, `doodads.ts`, `buildings.ts` (procedural low-poly) | Project code |
| Creeps, neutrals, Roshan, heroes (animated) | `src/world/units.ts`, `unitRig.ts` (procedural low-poly, rigid skinning) | Project code |
| Sky, sun/moon, stars, clouds | `src/world/sky.ts` (shader) | Project code |

When a CC0 asset is added, list it here as: name, author, license, URL.
