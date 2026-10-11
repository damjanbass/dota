// Shadow Fiend (6.83d values in src/data/heroes/shadowFiend.ts): Shadowraze ×3, Necromastery,
// Presence of the Dark Lord, Requiem of Souls.
import type { AbilityContext, AbilityImpl, CastTarget, SimApi } from '../../core/sim';
import { ABILITIES, levelValue } from '../../data';
import {
  advanceLine,
  damageTypeOf,
  dir2,
  isDisabled,
  kitState,
  newSkillshot,
  removeSkillshot,
  setStacks,
  spellTargetsAround,
  sr,
  stacksOf,
} from './common';

export const SOULS_KEY = 'souls';
export const NECROMASTERY_BUFF = 'sf_necromastery';
export const PRESENCE_BUFF = 'sf_presence_of_the_dark_lord';
export const RAZE_KEYS = ['nearDistance', 'mediumDistance', 'farDistance'] as const;

/**
 * Requiem line geometry is NOT in src/data (VERIFY #17 covers the slow; length/width/speed weren't
 * extracted either). Placeholders from the Dota 2 port of the spell until B confirms 6.83d values:
 * lines travel 1000 (scaled) at 700/s and hit units within 125 of the line head.
 */
export const REQUIEM_LINE_LENGTH = 1000;
export const REQUIEM_LINE_SPEED = 700;
export const REQUIEM_LINE_WIDTH = 125;

/** Raze centre distances (scaled) for a learned Shadowraze def. */
export const razeDistances = (level: number): [number, number, number] => {
  const def = ABILITIES['sf_shadowraze']!;
  return RAZE_KEYS.map((k) => sr(levelValue(def, k, level))) as [number, number, number];
};

/** Per-raze readiness (the sim only knows one 'sf_shadowraze' cooldown; see CONTRACT_REQUESTS.md G3). */
export const razeReady = (sim: SimApi, unitId: number, index: number): boolean => (kitState(sim).razeReadyAt.get(unitId)?.[index] ?? -Infinity) <= sim.time;

/** The bot picks which raze its next 'sf_shadowraze' cast fires. */
export const chooseRaze = (sim: SimApi, unitId: number, index: number): void => {
  kitState(sim).razeChoice.set(unitId, index);
};

const pickRaze = (ctx: AbilityContext, target: CastTarget): number => {
  const { sim, caster } = ctx;
  const s = kitState(sim);
  const chosen = s.razeChoice.get(caster.id);
  s.razeChoice.delete(caster.id);
  if (chosen !== undefined) return chosen;
  const p = target.point ?? (target.targetId !== undefined ? sim.get(target.targetId)?.position : undefined);
  const dists = razeDistances(ctx.level);
  if (!p) return [0, 1, 2].find((i) => razeReady(sim, caster.id, i)) ?? 0;
  const d = Math.hypot(p.x - caster.position.x, p.y - caster.position.y);
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < 3; i++) {
    const err = Math.abs(dists[i]! - d) + (razeReady(sim, caster.id, i) ? 0 : 1e6);
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
};

/**
 * One AbilityDef drives all three razes. The raze is chosen by chooseRaze() or by the cast point's
 * distance; the blast is centred along the cast direction (cast point if given, else facing).
 */
export const shadowraze = (): AbilityImpl => ({
  id: 'sf_shadowraze',
  cast(ctx, target) {
    const { sim, caster } = ctx;
    const index = pickRaze(ctx, target);
    const p = target.point ?? (target.targetId !== undefined ? sim.get(target.targetId)?.position : undefined) ?? caster.position;
    const dir = dir2(caster.position, p, caster.facing);
    const dist = razeDistances(ctx.level)[index]!;
    const cx = caster.position.x + dir.x * dist;
    const cy = caster.position.y + dir.y * dist;
    for (const u of spellTargetsAround(sim, caster, cx, cy, sr(ctx.value('radius')))) {
      sim.dealDamage({ sourceId: caster.id, targetId: u.id, amount: ctx.value('damage'), type: damageTypeOf(ctx), isAttack: false, abilityId: ctx.def.id });
    }
    const s = kitState(sim);
    const ready = s.razeReadyAt.get(caster.id) ?? [-Infinity, -Infinity, -Infinity];
    ready[index] = sim.time + ctx.value('cooldown');
    s.razeReadyAt.set(caster.id, ready);
  },
  tick(ctx) {
    // Mirror the per-raze cooldowns onto the sim's single cooldown so the other razes stay castable.
    const h = ctx.caster.hero;
    const ready = kitState(ctx.sim).razeReadyAt.get(ctx.caster.id);
    if (!h || !ready) return;
    const next = Math.min(...ready);
    if ((h.cooldownReadyAt[ctx.def.id] ?? 0) > next) h.cooldownReadyAt[ctx.def.id] = next;
  },
});

/** Necromastery: +1 soul per kill (cap by level), half lost on death; +2 damage per soul. */
export const necromastery = (sim: SimApi): AbilityImpl => {
  const def = ABILITIES['sf_necromastery']!;
  sim.events.on('unit:died', ({ unitId, killerId, denied }) => {
    const victim = sim.get(unitId);
    const victimLevel = victim?.hero?.skillLevels[def.id] ?? 0;
    if (victim && victimLevel > 0) {
      const souls = stacksOf(sim, victim.id, SOULS_KEY);
      setStacks(sim, victim.id, SOULS_KEY, Math.floor(souls * (1 - levelValue(def, 'soulsLostOnDeathPct', victimLevel))));
    }
    if (killerId === null || denied) return;
    const sf = sim.get(killerId);
    const level = sf?.hero?.skillLevels[def.id] ?? 0;
    if (!sf || level <= 0 || !victim || victim.team === sf.team) return;
    // Hero kills: the map hints at more souls (VERIFY #17); the data only confirms +1 per kill.
    const souls = stacksOf(sim, sf.id, SOULS_KEY) + levelValue(def, 'soulsPerKill', level);
    setStacks(sim, sf.id, SOULS_KEY, Math.min(levelValue(def, 'maxSouls', level), souls));
  });
  return {
    id: def.id,
    tick(ctx) {
      const damage = stacksOf(ctx.sim, ctx.caster.id, SOULS_KEY) * ctx.value('damagePerSoul');
      const cur = ctx.caster.buffs.find((b) => b.id === NECROMASTERY_BUFF);
      if ((cur?.damage ?? 0) === damage) return;
      if (damage <= 0) ctx.sim.removeBuff(ctx.caster.id, NECROMASTERY_BUFF);
      else ctx.sim.addBuff(ctx.caster.id, { id: NECROMASTERY_BUFF, sourceId: ctx.caster.id, expiresAt: Infinity, damage });
    },
  };
};

/** Presence of the Dark Lord: armor reduction aura on enemies (buildings included) within 900 (scaled). */
export const presenceOfTheDarkLord = (): AbilityImpl => {
  const nextAt = new Map<number, number>();
  return {
    id: 'sf_presence_of_the_dark_lord',
    tick(ctx) {
      const { sim, caster } = ctx;
      if ((nextAt.get(caster.id) ?? -Infinity) > sim.time) return;
      nextAt.set(caster.id, sim.time + 0.25);
      const armor = -ctx.value('armorReduction');
      for (const u of spellTargetsAround(sim, caster, caster.position.x, caster.position.y, sr(ctx.value('radius')), true)) {
        sim.addBuff(u.id, { id: PRESENCE_BUFF, sourceId: caster.id, expiresAt: sim.time + 0.5, armor });
      }
    },
  };
};

/** Requiem of Souls: after the 1 s cast time, souls/2 lines fly out evenly around Shadow Fiend. */
export const requiemOfSouls = (): AbilityImpl => ({
  id: 'sf_requiem_of_souls',
  cast(ctx) {
    kitState(ctx.sim).requiemPending.set(ctx.caster.id, { at: ctx.sim.time + ctx.value('castTime'), level: ctx.level });
  },
  tick(ctx, dt) {
    const { sim, caster } = ctx;
    const s = kitState(sim);
    const pending = s.requiemPending.get(caster.id);
    if (pending) {
      if (isDisabled(caster)) s.requiemPending.delete(caster.id);
      else if (sim.time >= pending.at) {
        s.requiemPending.delete(caster.id);
        const lines = Math.floor(stacksOf(sim, caster.id, SOULS_KEY) * ctx.value('linesPerSoul'));
        for (let i = 0; i < lines; i++) {
          const a = (i / lines) * Math.PI * 2;
          newSkillshot(sim, {
            kind: 'requiem',
            casterId: caster.id,
            abilityId: ctx.def.id,
            x: caster.position.x,
            y: caster.position.y,
            originX: caster.position.x,
            originY: caster.position.y,
            dirX: Math.cos(a),
            dirY: Math.sin(a),
            maxDist: sr(REQUIEM_LINE_LENGTH),
            speed: REQUIEM_LINE_SPEED,
            radius: REQUIEM_LINE_WIDTH,
            level: pending.level,
          });
        }
      }
    }
    const damage = levelValue(ctx.def, 'damagePerLine', ctx.level);
    for (const shot of s.skillshots.filter((x) => x.kind === 'requiem' && x.casterId === caster.id)) {
      advanceLine(shot, shot.speed * dt, (line) => {
        for (const u of spellTargetsAround(sim, caster, line.x, line.y, line.radius)) {
          if (line.hit.has(u.id)) continue;
          line.hit.add(u.id);
          sim.dealDamage({ sourceId: caster.id, targetId: u.id, amount: damage, type: damageTypeOf(ctx), isAttack: false, abilityId: ctx.def.id });
        }
        return false;
      });
      if (shot.traveled >= shot.maxDist) removeSkillshot(sim, shot);
    }
  },
});

export const shadowFiendAbilities = (sim: SimApi): AbilityImpl[] => [shadowraze(), necromastery(sim), presenceOfTheDarkLord(), requiemOfSouls()];
