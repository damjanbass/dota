// Extra per-unit WC3 fields that src/core/types.ts UnitDef doesn't carry (see CONTRACT_REQUESTS.md).

export interface UnitExtra {
  /** WC3 rawcode in the 6.83d map. */
  wc3Id: string;
  /** Attack backswing (seconds after the attack point before the unit can act). */
  attackBackswing: number;
  /** Auto-acquire range for targets (unscaled). */
  acquireRange: number;
  /** Unit-level spell cast point / backswing (WC3 castpt / castbsw). */
  castPoint?: number;
  castBackswing?: number;
  modelScale?: number;
  /** Projectile launch / impact heights (WC3 units above the feet). */
  launchZ?: number;
  impactZ?: number;
  /** Movement type: foot, hover, fly, or none for buildings. */
  moveType?: 'foot' | 'hover' | 'fly' | 'none';
  /** WC3 unit level (drives the creep XP table). */
  unitLevel?: number;
  /** WC3 upgrade id that scales this unit over time, if any. */
  upgradeId?: string;
}
