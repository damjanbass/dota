// R Assassinate. FPS side: the WC3 casting time ("draw a bead", aimTime) becomes an aim lock — the crosshair has to
// stay on one visible enemy hero for aimTime, then the kit casts. Sim side: a homing bullet (projectileSpeed) that
// deals magical damage and a mini-stun (interrupts channels).
import type { AbilityImpl } from '../../core/sim';
import { ASSASSINATE, ASSASSINATE_VISUAL, BUFF } from './ids';

export const createAssassinateImpl = (): AbilityImpl => ({
  id: ASSASSINATE,
  cast(ctx, target) {
    const targetId = target.targetId;
    if (targetId === undefined) return;
    const sourceId = ctx.caster.id;
    const damage = ctx.value('damage');
    const ministun = ctx.value('ministun');
    ctx.sim.launchProjectile({
      sourceId,
      targetId,
      speed: ctx.value('projectileSpeed'),
      visual: ASSASSINATE_VISUAL,
      onHit: (sim) => {
        const t = sim.get(targetId);
        if (!t || !t.alive) return;
        sim.dealDamage({ sourceId, targetId, amount: damage, type: 'magical', isAttack: false, abilityId: ASSASSINATE });
        if (t.alive) sim.addBuff(targetId, { id: BUFF.assassinateStun, sourceId, expiresAt: sim.time + ministun, stunned: true });
      },
    });
  },
});

export type AimStatus = 'idle' | 'searching' | 'locking' | 'fire';

/**
 * Aim-lock state machine (pure). Feed it the hero currently under the crosshair (or null) every tick.
 * Switching to another hero restarts the lock; losing the target for longer than `grace` resets it.
 */
export class AssassinateAim {
  active = false;
  targetId: number | null = null;
  /** Seconds held on the current target. */
  held = 0;
  /** Seconds since the crosshair left the target (within the grace window). */
  lostFor = 0;
  /** Total seconds in aim mode. */
  elapsed = 0;

  start(): void {
    this.active = true;
    this.reset();
    this.elapsed = 0;
  }

  cancel(): void {
    this.active = false;
    this.reset();
  }

  /** 0..1 progress towards aimTime. */
  progress(aimTime: number): number {
    return aimTime > 0 ? Math.min(1, this.held / aimTime) : 1;
  }

  update(dt: number, candidate: number | null, aimTime: number, grace: number): AimStatus {
    if (!this.active) return 'idle';
    this.elapsed += dt;
    if (candidate !== null) {
      if (candidate !== this.targetId) {
        this.targetId = candidate;
        this.held = 0;
      }
      this.lostFor = 0;
      this.held += dt;
    } else if (this.targetId !== null) {
      this.lostFor += dt;
      if (this.lostFor > grace + 1e-9) this.reset();
    }
    if (this.targetId === null) return 'searching';
    return this.held >= aimTime - 1e-9 ? 'fire' : 'locking';
  }

  private reset(): void {
    this.targetId = null;
    this.held = 0;
    this.lostFor = 0;
  }
}
