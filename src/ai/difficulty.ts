// Bot difficulty tuning. These are AI behaviour knobs, not DotA data.
import type { Difficulty } from '../core/sim';

export interface DifficultyParams {
  /** Seconds before newly seen enemies / threats are acted on; also the age of the enemy positions bots aim at. */
  reactionTime: number;
  /** Seconds between decisions. */
  thinkInterval: number;
  /** Chance to go for an available last hit / deny. */
  lastHitSkill: number;
  /** ± fractional error in the bot's own damage estimate when timing last hits. */
  lastHitError: number;
  /** Whether the bot denies at all. */
  denies: boolean;
  /** Std-dev-ish angular aim error for skillshots (radians). */
  aimError: number;
  /** Fraction of the estimated target velocity used to lead skillshots (0 = aim at last seen position). */
  leadFactor: number;
  /** HP fraction that triggers a retreat. */
  retreatHp: number;
  /** HP fraction needed to leave the fountain. */
  returnHp: number;
  /** Chance per think to harass a hero in range while laning. */
  harassChance: number;
  /** Use spells on enemy heroes while laning (not just in fights). */
  laneSpells: boolean;
  /** Fight decision threshold: lower = more aggressive. */
  fightThreshold: number;
  /** Max chase distance from where the fight started (units). */
  chaseDistance: number;
  /** Rotates to gank the player's lane in mid-game. */
  ganks: boolean;
  /** Earliest game time (s) for ganks. */
  gankFrom: number;
  /** Seconds between gank attempts. */
  gankCooldown: number;
  /** Weaves spells into combos (otherwise casts one spell at a time with pauses). */
  combos: boolean;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: {
    reactionTime: 0.6,
    thinkInterval: 0.3,
    lastHitSkill: 0.45,
    lastHitError: 0.35,
    denies: false,
    aimError: 0.14,
    leadFactor: 0,
    retreatHp: 0.2,
    returnHp: 0.75,
    harassChance: 0.05,
    laneSpells: false,
    fightThreshold: 1.35,
    chaseDistance: 1200,
    ganks: false,
    gankFrom: Infinity,
    gankCooldown: Infinity,
    combos: false,
  },
  medium: {
    reactionTime: 0.35,
    thinkInterval: 0.2,
    lastHitSkill: 0.75,
    lastHitError: 0.15,
    denies: true,
    aimError: 0.08,
    leadFactor: 0.6,
    retreatHp: 0.28,
    returnHp: 0.85,
    harassChance: 0.12,
    laneSpells: true,
    fightThreshold: 1.1,
    chaseDistance: 1800,
    ganks: false,
    gankFrom: Infinity,
    gankCooldown: Infinity,
    combos: true,
  },
  hard: {
    reactionTime: 0.18,
    thinkInterval: 0.1,
    lastHitSkill: 0.95,
    lastHitError: 0.05,
    denies: true,
    aimError: 0.045,
    leadFactor: 1,
    retreatHp: 0.35,
    returnHp: 0.92,
    harassChance: 0.2,
    laneSpells: true,
    fightThreshold: 0.9,
    chaseDistance: 2400,
    ganks: true,
    gankFrom: 8 * 60,
    gankCooldown: 150,
    combos: true,
  },
};
