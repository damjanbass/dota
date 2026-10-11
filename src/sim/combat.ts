// Built-in unit AI (lane creeps, towers, fountains, neutrals, bot-hero orders), basic attacks with attack point /
// backswing and homing projectiles, DotA creep and tower aggro, item passives and the damage pipeline.
import { scaledRange } from '../core/config';
import type { DamageRequest } from '../core/sim';
import type { GameEvents } from '../core/types';
import { ABILITIES, ITEM_PASSIVES, NEUTRALS, TOWER_RULES } from '../data';
import { moveTo } from './movement';
import { magicalMultiplier, physicalMultiplier } from './stats';
import { TUNABLES } from './tunables';
import { TEAM_BIT } from './types';
import type { SimUnit } from './types';
import { IDLE_ORDER } from './world';
import type { World } from './world';

export const Fight = { Attacking: 0, Chasing: 1, Lost: 2 } as const;
export type Fight = (typeof Fight)[keyof typeof Fight];

/** Deny thresholds (fraction of max HP). Creeps: 50% (DotA). Towers: 10% (DotA tower-deny rule). */
export const DENY_THRESHOLD = { creep: 0.5, tower: 0.1 } as const;

const isCreepKind = (u: SimUnit): boolean => u.kind === 'creep_melee' || u.kind === 'creep_ranged' || u.kind === 'creep_siege';

/** An ally the player / a hero may attack to deny it. */
export const isDeniable = (u: SimUnit): boolean => {
  if (!u.alive) return false;
  if (isCreepKind(u)) return u.hp < u.maxHp * DENY_THRESHOLD.creep;
  if (u.kind === 'tower') return u.hp < u.maxHp * DENY_THRESHOLD.tower;
  return false;
};

const radiusOf = (u: SimUnit): number => u.def.collisionRadius;

/** Auto-acquirable enemy: alive, hostile, visible to the unit's team, not invulnerable. */
export const isValidTarget = (w: World, u: SimUnit, t: SimUnit): boolean =>
  t.alive && !t.removed && t.team !== u.team && (t.visMask & TEAM_BIT[u.team]) !== 0 && !w.isInvulnerable(t);

const acquireScratch: SimUnit[] = [];

/** Closest valid target whose edge is within `radius` of the unit. */
export const findTarget = (w: World, u: SimUnit, radius: number): SimUnit | null => {
  acquireScratch.length = 0;
  w.queryInto(u.position.x, u.position.y, radius + 200, acquireScratch);
  let best: SimUnit | null = null;
  let bestD = Infinity;
  for (const t of acquireScratch) {
    if (t === u || !isValidTarget(w, u, t)) continue;
    if (t.id === u.ignoreId && w.time < u.ignoreUntil) continue;
    // Lane creeps only fight neutrals that attack them (pulls); scaled acquire ranges would drag them into camps.
    if (u.behaviour === 'lane' && t.team === 'neutral' && t.targetId !== u.id) continue;
    const dx = t.position.x - u.position.x;
    const dy = t.position.y - u.position.y;
    const d = Math.sqrt(dx * dx + dy * dy) - radiusOf(t);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = t;
    }
  }
  acquireScratch.length = 0;
  return best;
};

const distance = (a: SimUnit, b: SimUnit): number => {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const reachOf = (w: World, u: SimUnit, t: SimUnit): number => w.unitStats(u).attackRange + radiusOf(u) + radiusOf(t);

export const inAttackRange = (w: World, u: SimUnit, t: SimUnit): boolean => distance(u, t) <= reachOf(w, u, t);

const acquireRangeOf = (u: SimUnit): number => scaledRange(u.extra?.acquireRange ?? u.def.acquireRange ?? Math.max(u.def.attackRange, 500));

const face = (u: SimUnit, t: SimUnit): void => {
  u.facing = Math.atan2(t.position.y - u.position.y, t.position.x - u.position.x);
};

/**
 * One tick of attacking `t`: walk into range (if allowed), wind up, release at the attack point, backswing.
 * Attack point and backswing scale with attack speed like WC3.
 */
export const fight = (w: World, u: SimUnit, t: SimUnit, dt: number, canMove: boolean): Fight => {
  const st = w.unitStats(u);
  if (st.attackCooldown <= 0 || st.attackRange <= 0) return Fight.Lost;
  const d = distance(u, t);
  const reach = st.attackRange + radiusOf(u) + radiusOf(t);
  const speed = u.def.attackCooldown / st.attackCooldown;
  const backswing = u.extra?.attackBackswing ?? u.def.attackBackswing ?? 0.3;

  if (u.attackPhase === 1) {
    if (d > reach + scaledRange(TUNABLES.attackRangeBuffer)) {
      u.attackPhase = 0;
    } else {
      face(u, t);
      if (w.time >= u.phaseEnd) {
        u.attackPhase = 2;
        u.phaseEnd = w.time + backswing / speed;
        releaseAttack(w, u, t);
      }
      return Fight.Attacking;
    }
  }
  if (u.attackPhase === 2) {
    if (w.time < u.phaseEnd) return Fight.Attacking;
    u.attackPhase = 0;
  }
  if (d <= reach) {
    face(u, t);
    if (w.time >= u.attackReadyAt) {
      u.attackReadyAt = w.time + st.attackCooldown;
      if (u.def.attackPoint <= 0) {
        u.attackPhase = 2;
        u.phaseEnd = w.time + backswing / speed;
        releaseAttack(w, u, t);
      } else {
        u.attackPhase = 1;
        u.phaseEnd = w.time + u.def.attackPoint / speed;
      }
    }
    return Fight.Attacking;
  }
  if (!canMove) return Fight.Lost;
  moveTo(w, u, t.position.x, t.position.y, dt, Math.max(0, reach - 8));
  return Fight.Chasing;
};

/** Projectile visual id: 'tower_<team>', 'fountain_<team>', else the attacker's def id. */
export const attackVisual = (u: SimUnit): string =>
  u.kind === 'tower' ? `tower_${u.team}` : u.kind === 'fountain' ? `fountain_${u.team}` : u.def.id;

/** The attack point: melee damage now, ranged as a homing projectile. */
const releaseAttack = (w: World, u: SimUnit, t: SimUnit): void => {
  w.events.emit('unit:attack', { sourceId: u.id, targetId: t.id });
  w.breakInvisibility(u);
  if (u.hero && t.hero && t.team !== u.team) onHeroAttacksHero(w, u, t);
  if (u.ranged && u.def.projectileSpeed) {
    w.launchInternalProjectile(u, t, u.def.projectileSpeed, attackVisual(u), () => {
      resolveAttack(w, u, t, false);
    });
  } else {
    resolveAttack(w, u, t, false);
  }
};

const aggroScratch: SimUnit[] = [];

/**
 * DotA aggro: when a hero basic-attacks an enemy hero, the victim's lane creeps near the attacker switch to the
 * attacker, and the victim's towers that have the attacker in range switch to it.
 */
export const onHeroAttacksHero = (w: World, attacker: SimUnit, victim: SimUnit): void => {
  const lockUntil = w.time + TUNABLES.creepAggroLock;
  aggroScratch.length = 0;
  w.queryInto(attacker.position.x, attacker.position.y, scaledRange(TUNABLES.creepAggroRadius), aggroScratch);
  for (const c of aggroScratch) {
    if (!c.alive || c.team !== victim.team || c.behaviour !== 'lane') continue;
    if (c.targetId !== attacker.id && c.attackPhase === 1) c.attackPhase = 0;
    c.targetId = attacker.id;
    c.forcedUntil = lockUntil;
    c.chaseTime = 0;
  }
  aggroScratch.length = 0;
  for (const tw of w.attackers) {
    if (!tw.alive || tw.team !== victim.team || tw.kind !== 'tower') continue;
    if (!inAttackRange(w, tw, attacker) || w.isInvulnerable(attacker)) continue;
    if (tw.targetId !== attacker.id && tw.attackPhase === 1) tw.attackPhase = 0;
    tw.targetId = attacker.id;
    tw.forcedUntil = lockUntil;
  }
};

// ---------------------------------------------------------------------------
// Attack resolution: evasion, item passives, ability hooks, damage, lifesteal
// ---------------------------------------------------------------------------

interface AttackMods {
  crit: number;
  bonus: number;
  stun: number;
  lifesteal: number;
  chain: number;
  trueStrike: boolean;
}

const mods: AttackMods = { crit: 1, bonus: 0, stun: 0, lifesteal: 0, chain: 0, trueStrike: false };

const rollItemPassives = (w: World, attacker: SimUnit, target: SimUnit): AttackMods => {
  mods.crit = 1;
  mods.bonus = 0;
  mods.stun = 0;
  mods.lifesteal = 0;
  mods.chain = 0;
  mods.trueStrike = false;
  const items = attacker.hero?.items;
  if (!items) return mods;
  for (const item of items) {
    if (!item) continue;
    const passives = ITEM_PASSIVES[item];
    if (!passives) continue;
    for (const pid of passives) {
      const v = ABILITIES[pid]?.values;
      if (!v) continue;
      const chance = v.chance?.[0] ?? 0;
      if (v.trueStrike) mods.trueStrike = true;
      if (v.multiplier) {
        if (!target.isBuilding && w.rng.chance(chance)) mods.crit = Math.max(mods.crit, v.multiplier[0]!);
      } else if (v.bonusDamage) {
        if (!target.isBuilding && w.rng.chance(chance)) {
          mods.bonus += v.bonusDamage[0]!;
          if (v.ministun) mods.stun = Math.max(mods.stun, v.ministun[0]!);
        }
      } else if (v.lifesteal) {
        mods.lifesteal = Math.max(mods.lifesteal, v.lifesteal[0]!);
      } else if (v.damage && chance > 0) {
        if (!target.isBuilding && w.rng.chance(chance)) mods.chain = Math.max(mods.chain, v.damage[0]!);
      }
    }
  }
  return mods;
};

/** Evasion from item passives (multiplicative stacking: 1 - Π(1 - e)). */
export const evasionOf = (u: SimUnit): number => {
  const items = u.hero?.items;
  if (!items) return 0;
  let through = 1;
  for (const item of items) {
    if (!item) continue;
    for (const pid of ITEM_PASSIVES[item] ?? []) {
      const e = ABILITIES[pid]?.values.evasion?.[0];
      if (e) through *= 1 - e;
    }
  }
  return 1 - through;
};

const runOnAttackHooks = (w: World, attacker: SimUnit, req: DamageRequest): void => {
  const h = attacker.hero;
  if (h) {
    for (const id in h.skillLevels) {
      const level = h.skillLevels[id]!;
      if (level <= 0) continue;
      const impl = w.impls.get(id);
      if (!impl?.onAttack) continue;
      const ctx = w.abilityContext(attacker, id, level);
      if (ctx) impl.onAttack(ctx, req);
    }
    return;
  }
  for (const id of attacker.def.abilities) {
    const impl = w.impls.get(id);
    if (!impl?.onAttack) continue;
    const ctx = w.abilityContext(attacker, id, 1);
    if (ctx) impl.onAttack(ctx, req);
  }
};

const chainScratch: SimUnit[] = [];

const chainLightning = (w: World, attacker: SimUnit, first: SimUnit, damage: number): void => {
  const hit = new Set<number>();
  let current: SimUnit | null = first;
  for (let k = 0; k < TUNABLES.chainLightningTargets && current; k++) {
    hit.add(current.id);
    applyDamage(w, { sourceId: attacker.id, targetId: current.id, amount: damage, type: 'magical', isAttack: false, abilityId: 'chain_lightning' });
    chainScratch.length = 0;
    w.queryInto(current.position.x, current.position.y, scaledRange(TUNABLES.chainLightningRadius), chainScratch);
    let next: SimUnit | null = null;
    let bestD = Infinity;
    for (const c of chainScratch) {
      if (hit.has(c.id) || c.isBuilding || !isValidTarget(w, attacker, c)) continue;
      const d = distance(current, c);
      if (d < bestD) {
        bestD = d;
        next = c;
      }
    }
    current = next;
  }
  chainScratch.length = 0;
};

/**
 * Applies a basic attack from `attacker` to `target`: damage roll, evasion, item passives (crit, bash, lifesteal,
 * chain lightning), passive ability onAttack hooks (e.g. Headshot), then the damage pipeline.
 */
export const resolveAttack = (w: World, attacker: SimUnit, target: SimUnit, headshot: boolean): number => {
  if (!target.alive) return 0;
  const st = w.unitStats(attacker);
  const amount = st.damageMin + w.rng.next() * (st.damageMax - st.damageMin);
  const m = rollItemPassives(w, attacker, target);
  const crit = m.crit;
  const bonus = m.bonus;
  const stun = m.stun;
  const lifesteal = m.lifesteal;
  const chain = m.chain;
  if (!m.trueStrike) {
    const ev = evasionOf(target);
    if (ev > 0 && w.rng.chance(ev)) return 0;
  }
  const req: DamageRequest = {
    sourceId: attacker.id,
    targetId: target.id,
    amount: amount * crit + bonus,
    type: 'physical',
    isAttack: true,
    attackType: st.attackType,
    headshot,
  };
  runOnAttackHooks(w, attacker, req);
  const dealt = applyDamage(w, req);
  if (stun > 0 && target.alive) w.addBuff(target.id, { id: 'item_bash_stun', sourceId: attacker.id, expiresAt: w.time + stun, stunned: true });
  if (lifesteal > 0 && dealt > 0 && !target.isBuilding) w.heal(attacker.id, dealt * lifesteal);
  if (chain > 0 && target.alive) chainLightning(w, attacker, target, chain);
  return dealt;
};

// ---------------------------------------------------------------------------
// Damage pipeline
// ---------------------------------------------------------------------------

const campScratch: SimUnit[] = [];

/** Physical: armor × attack type; magical: magic resistance; pure: unreduced. Returns damage dealt. */
export const applyDamage = (w: World, req: DamageRequest): number => {
  const t = w.byId.get(req.targetId);
  if (!t || !t.alive || !(req.amount > 0)) return 0;
  if (w.isInvulnerable(t)) return 0;
  const src = req.sourceId !== null ? w.byId.get(req.sourceId) : undefined;
  const ts = w.unitStats(t);
  let mult: number;
  if (req.type === 'physical') {
    const attackType = req.attackType ?? (req.isAttack ? (src ? w.unitStats(src).attackType : 'normal') : undefined);
    mult = physicalMultiplier(ts.armor, attackType, ts.armorType);
  } else if (req.type === 'magical') {
    if (w.isMagicImmune(t)) return 0;
    mult = magicalMultiplier(ts.magicResistance);
  } else {
    if (w.isMagicImmune(t) && !req.isAttack) return 0;
    mult = 1;
  }
  let dmg = req.amount * mult;
  if (t.isBuilding) {
    if (t.bdProtected && src?.hero && src.team !== t.team) dmg *= 1 - TOWER_RULES.noCreepDamageHealPct;
    if (!t.bdProtected || (src && src.team === t.team)) t.bdCap -= dmg;
  }
  if (!(dmg > 0)) return 0;
  t.hp -= dmg;

  if (src && src.team !== t.team) {
    let dispelled = false;
    for (let i = t.buffs.length - 1; i >= 0; i--) {
      if (t.buffs[i]!.dispelOnDamage) {
        t.buffs.splice(i, 1);
        dispelled = true;
      }
    }
    if (dispelled) w.markDirty(t);
    retaliate(w, t, src);
  }

  const payload: GameEvents['unit:damaged'] = { targetId: t.id, sourceId: src ? src.id : req.sourceId, amount: dmg, headshot: !!req.headshot };
  w.events.emit('unit:damaged', payload);
  if (t.hp <= 0) w.killUnit(t, src ?? null);
  return dmg;
};

/** Neutrals (and their camp) and idle bots respond to being attacked. */
const retaliate = (w: World, t: SimUnit, src: SimUnit): void => {
  if (!src.alive) return;
  if (t.behaviour === 'guard' && !t.returning && t.targetId === 0) {
    t.targetId = src.id;
    t.leashTimer = 0;
    if (t.campIndex >= 0) {
      campScratch.length = 0;
      w.queryInto(t.position.x, t.position.y, 600, campScratch);
      for (const c of campScratch) {
        if (c.alive && c.campIndex === t.campIndex && c.targetId === 0 && !c.returning) c.targetId = src.id;
      }
      campScratch.length = 0;
    }
  } else if (t.behaviour === 'hero' && t.order.type === 'idle' && t.targetId === 0 && src.team !== 'neutral') {
    t.targetId = src.id;
  }
};

// ---------------------------------------------------------------------------
// Player rifle
// ---------------------------------------------------------------------------

/** 'player:shot' → a basic attack from the player hero (denies only under the DotA thresholds). */
export const onPlayerShot = (w: World, p: GameEvents['player:shot']): void => {
  const id = p.result.targetId;
  if (id === null) return;
  const player = w.byId.get(w.player().id);
  if (!player || !player.alive || w.isStunned(player)) return;
  const t = w.byId.get(id);
  if (!t || !t.alive || t === player) return;
  if (t.team === player.team && !isDeniable(t)) return;
  w.breakInvisibility(player);
  if (t.hero && t.team !== player.team) onHeroAttacksHero(w, player, t);
  resolveAttack(w, player, t, p.result.part === 'head');
};

// ---------------------------------------------------------------------------
// Per-behaviour AI
// ---------------------------------------------------------------------------

const validCurrent = (w: World, u: SimUnit): SimUnit | null => {
  if (!u.targetId) return null;
  const t = w.byId.get(u.targetId);
  if (t && isValidTarget(w, u, t)) return t;
  u.targetId = 0;
  u.forcedUntil = 0;
  u.chaseTime = 0;
  if (u.attackPhase === 1) u.attackPhase = 0;
  return null;
};

const structureAI = (w: World, u: SimUnit, dt: number): void => {
  const st = w.unitStats(u);
  if (st.attackRange <= 0 || st.attackCooldown <= 0) return;
  let t = validCurrent(w, u);
  if (t && !inAttackRange(w, u, t) && u.attackPhase !== 1) {
    t = null;
    u.targetId = 0;
  }
  if (!t && w.time >= u.nextAcquireAt) {
    u.nextAcquireAt = w.time + TUNABLES.structureAcquireInterval;
    t = findTarget(w, u, st.attackRange);
    u.targetId = t ? t.id : 0;
  }
  if (t) {
    if (fight(w, u, t, dt, false) === Fight.Lost) u.targetId = 0;
  } else if (u.attackPhase === 2 && w.time >= u.phaseEnd) {
    u.attackPhase = 0;
  }
};

const laneAI = (w: World, u: SimUnit, dt: number): void => {
  let t = validCurrent(w, u);
  const forced = w.time < u.forcedUntil;
  if (!forced && w.time >= u.nextAcquireAt) {
    u.nextAcquireAt = w.time + TUNABLES.acquireInterval;
    if (!t || !inAttackRange(w, u, t)) {
      const c = findTarget(w, u, acquireRangeOf(u));
      if (c && c !== t) {
        if (u.attackPhase === 1) u.attackPhase = 0;
        t = c;
        u.targetId = c.id;
        u.chaseTime = 0;
      }
    }
  }
  if (t) {
    const r = fight(w, u, t, dt, true);
    if (r === Fight.Chasing) {
      u.chaseTime += dt;
      if (u.chaseTime > TUNABLES.creepChaseTime) {
        u.ignoreId = t.id;
        u.ignoreUntil = w.time + TUNABLES.creepGiveUpIgnore;
        u.targetId = 0;
        u.forcedUntil = 0;
        u.chaseTime = 0;
      }
    } else if (r === Fight.Attacking) {
      u.chaseTime = 0;
    } else {
      u.targetId = 0;
    }
    return;
  }
  if (u.attackPhase === 2 && w.time < u.phaseEnd) return;
  u.attackPhase = 0;
  followLane(w, u, dt);
};

const followLane = (w: World, u: SimUnit, dt: number): void => {
  const path = u.lanePath;
  if (!path) return;
  const p = u.position;
  const r2 = TUNABLES.laneArriveRadius * TUNABLES.laneArriveRadius;
  let advanced = false;
  while (u.laneIndex < path.length) {
    const a = path[u.laneIndex]!;
    const dx = a.x - p.x;
    const dy = a.y - p.y;
    if (dx * dx + dy * dy <= r2) {
      u.laneIndex++;
      advanced = true;
      continue;
    }
    // Already past this waypoint along the next segment (pushed or chased ahead): skip it.
    if (u.laneIndex + 1 < path.length) {
      const b = path[u.laneIndex + 1]!;
      if ((b.x - a.x) * (p.x - a.x) + (b.y - a.y) * (p.y - a.y) > 0) {
        u.laneIndex++;
        advanced = true;
        continue;
      }
    }
    break;
  }
  if (u.laneIndex >= path.length) {
    if (u.order.type !== 'idle') u.order = IDLE_ORDER;
    return;
  }
  const wp = path[u.laneIndex]!;
  if (advanced || u.order.type !== 'attackMove') u.order = { type: 'attackMove', x: wp.x, y: wp.y };
  moveTo(w, u, wp.x, wp.y, dt, 0);
};

const guardDistance = (): number => (TUNABLES.scaleGuardDistance ? scaledRange(NEUTRALS.guardDistance) : NEUTRALS.guardDistance);

const guardAI = (w: World, u: SimUnit, dt: number): void => {
  const home = u.home;
  if (!home) return;
  const hx = home.x - u.position.x;
  const hy = home.y - u.position.y;
  const dHome = Math.sqrt(hx * hx + hy * hy);
  if (u.returning) {
    u.targetId = 0;
    if (moveTo(w, u, home.x, home.y, dt, 24)) {
      u.returning = false;
      u.leashTimer = 0;
    }
    return;
  }
  let t = validCurrent(w, u);
  if (!t && w.time >= u.nextAcquireAt) {
    u.nextAcquireAt = w.time + TUNABLES.acquireInterval;
    t = findTarget(w, u, acquireRangeOf(u));
    u.targetId = t ? t.id : 0;
  }
  if (t) {
    const r = fight(w, u, t, dt, true);
    if (dHome > guardDistance()) {
      u.returning = true;
      u.targetId = 0;
      u.attackPhase = 0;
      return;
    }
    if (r === Fight.Attacking) u.leashTimer = 0;
    else {
      u.leashTimer += dt;
      if (u.leashTimer > NEUTRALS.guardReturnTime || r === Fight.Lost) {
        u.returning = true;
        u.targetId = 0;
        u.attackPhase = 0;
      }
    }
    return;
  }
  if (u.attackPhase === 2 && w.time < u.phaseEnd) return;
  u.attackPhase = 0;
  if (dHome > 24) moveTo(w, u, home.x, home.y, dt, 16);
};

/** Idle / hold: auto-acquire and fight (idle may chase within 1.5× acquire range). */
const idleCombat = (w: World, u: SimUnit, dt: number, canMove: boolean): void => {
  let t = validCurrent(w, u);
  const st = w.unitStats(u);
  const radius = canMove ? acquireRangeOf(u) : st.attackRange;
  if (t && canMove && distance(u, t) > radius * 1.5) {
    u.targetId = 0;
    t = null;
  }
  if (!t && w.time >= u.nextAcquireAt) {
    u.nextAcquireAt = w.time + TUNABLES.acquireInterval;
    t = findTarget(w, u, radius);
    u.targetId = t ? t.id : 0;
  }
  if (t) {
    if (fight(w, u, t, dt, canMove) === Fight.Lost) u.targetId = 0;
    return;
  }
  if (u.attackPhase === 2 && w.time >= u.phaseEnd) u.attackPhase = 0;
};

const heroAI = (w: World, u: SimUnit, dt: number): void => {
  const o = u.order;
  switch (o.type) {
    case 'idle':
      idleCombat(w, u, dt, true);
      return;
    case 'hold':
      idleCombat(w, u, dt, false);
      return;
    case 'move':
      u.attackPhase = 0;
      if (moveTo(w, u, o.x, o.y, dt, 8)) u.order = IDLE_ORDER;
      return;
    case 'attackMove': {
      let t = validCurrent(w, u);
      if (!t && w.time >= u.nextAcquireAt) {
        u.nextAcquireAt = w.time + TUNABLES.acquireInterval;
        t = findTarget(w, u, acquireRangeOf(u));
        u.targetId = t ? t.id : 0;
      }
      if (t) {
        if (fight(w, u, t, dt, true) === Fight.Lost) u.targetId = 0;
        return;
      }
      if (u.attackPhase === 2 && w.time < u.phaseEnd) return;
      u.attackPhase = 0;
      if (moveTo(w, u, o.x, o.y, dt, 8)) u.order = IDLE_ORDER;
      return;
    }
    case 'attack': {
      const t = w.byId.get(o.targetId);
      const ok = !!t && t.alive && !w.isInvulnerable(t) && (t.team !== u.team ? (t.visMask & TEAM_BIT[u.team]) !== 0 : isDeniable(t));
      if (!ok) {
        u.order = IDLE_ORDER;
        u.targetId = 0;
        u.attackPhase = 0;
        return;
      }
      u.targetId = t.id;
      fight(w, u, t, dt, true);
      return;
    }
    case 'cast': {
      const def = ABILITIES[o.abilityId];
      if (!def) {
        u.order = IDLE_ORDER;
        return;
      }
      const target = o.targetId !== undefined ? w.byId.get(o.targetId) : undefined;
      const tx = target ? target.position.x : (o.x ?? u.position.x);
      const ty = target ? target.position.y : (o.y ?? u.position.y);
      const level = u.hero?.skillLevels[o.abilityId] || 1;
      const range = scaledRange(def.castRange[Math.min(level, def.castRange.length) - 1] ?? 0);
      if (range > 0) {
        const dx = tx - u.position.x;
        const dy = ty - u.position.y;
        if (Math.sqrt(dx * dx + dy * dy) > range + (target ? radiusOf(target) : 0)) {
          u.attackPhase = 0;
          moveTo(w, u, tx, ty, dt, range * 0.9);
          return;
        }
      }
      w.castAbility(u.id, o.abilityId, target ? { targetId: target.id } : { point: { x: tx, y: ty } });
      if (u.order === o) u.order = IDLE_ORDER;
      return;
    }
  }
};

/** One tick of the built-in AI for a non-player unit. */
export const updateUnitAI = (w: World, u: SimUnit, dt: number): void => {
  if (u.behaviour === 'player') return;
  if (w.isStunned(u)) {
    u.attackPhase = 0;
    return;
  }
  if (u.pendingCast) return;
  switch (u.behaviour) {
    case 'structure':
      structureAI(w, u, dt);
      return;
    case 'lane':
      laneAI(w, u, dt);
      return;
    case 'guard':
      guardAI(w, u, dt);
      return;
    case 'hero':
      heroAI(w, u, dt);
      return;
  }
};
