// Values the 6.83d data in src/data does not provide. Every entry is a TUNABLE (not in data) choice made by the
// simulation; the rules themselves (waves, gold, XP, respawn, runes, neutrals, towers) come from src/data/tables.ts.
// Distances marked "unscaled" are DotA-style ranges and get multiplied by RANGE_SCALE at runtime.

export const TUNABLES = {
  /** Creeps switch to an enemy hero that basic-attacks one of their heroes within this radius of the attacker (unscaled). */
  creepAggroRadius: 500,
  /** Seconds an aggro'd creep stays locked on the attacking hero before it re-evaluates targets. */
  creepAggroLock: 2.5,
  /** Seconds a lane creep chases a target it cannot reach before it gives up and resumes its lane. */
  creepChaseTime: 3,
  /** After giving up a chase, a creep ignores that target for this long. */
  creepGiveUpIgnore: 3,
  /** Seconds between target-acquisition scans (lane creeps, neutrals, idle bots); staggered per unit. */
  acquireInterval: 0.3,
  /** Towers and the fountain rescan this often while they have no target. */
  structureAcquireInterval: 0.1,
  /** An attack windup still completes if the target is within range + this buffer (unscaled). */
  attackRangeBuffer: 100,
  /** Seconds a dead non-hero unit stays in units() (death animation) before removal. */
  corpseTime: 3,
  /** A lane creep counts a waypoint as reached within this distance (map units). */
  laneArriveRadius: 150,
  /** Neutral camp spawn-block area: radius around the camp marker (map units). */
  neutralCampRadius: 350,
  /** Group members are placed on a circle of this radius around the camp marker (map units). */
  neutralSpawnSpread: 110,
  /** Hero within this distance of a rune picks it up (map units). */
  runePickupRadius: 100,
  /** buyItem requires a matching shop entity within this distance (map units). */
  shopRadius: 600,
  /** Extra slack on cast range checks (unscaled). */
  castRangeBuffer: 50,
  /** Backdoor protection: enemy lane creeps within this radius of a building (map units). */
  backdoorRadius: 1000,
  /** Chain lightning (Maelstrom / Mjollnir): total targets and jump radius (unscaled). */
  chainLightningTargets: 4,
  chainLightningRadius: 500,
  /** Multi-kill window (Double Kill, Triple Kill, ...). */
  multiKillWindow: 18,
  /** Minimum personal-space radius for unit separation (map units). */
  separationMinRadius: 12,
  /** Vision is recomputed this often (seconds). */
  visionInterval: 0.2,
  /** IAS clamp (WC3: -80% .. +400%). */
  minIas: -0.8,
  maxIas: 4,
  /** Re-path a moving goal at most this often (seconds), when a PathFinder is registered. */
  repathInterval: 0.75,
  /** Straight-line movement (no PathFinder query) when the goal is closer than this (map units). */
  straightLineDistance: 320,
  /** Heroes respawn this far around their team's hero spawn (map units). */
  heroSpawnSpread: 90,
  /** Bounty rune gold is reliable (DotA 1 rule unknown; Dota 2 treats it as reliable). */
  bountyRuneGoldReliable: true,
  /** Damage-over-time buffs tick (and emit unit:damaged) this often (seconds). */
  dpsTickInterval: 0.25,
  /** If the killer is not a hero, the Aegis goes to the nearest allied hero of the killer within this radius (unscaled). */
  aegisFallbackRadius: 1300,
  /** Neutral and Roshan leash distance (6.83d GuardDistance 600) is treated as an aggro range and scaled. */
  scaleGuardDistance: true,
  /** Tango needs a tree cell within this distance of the target point (map units). */
  tangoTreeSearch: 96,
  /** True when a hero standing on a ramp tile counts one cliff level higher for vision. */
  rampSeesUp: true,
} as const;
