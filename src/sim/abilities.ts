// Generic ability pipeline: learning (skill points + requiredLevels), casting (learned level / item, stun,
// silence, mana, cooldown, charges, cast range, cast point), charge regeneration, per-tick hooks, and the built-in
// consumable item actives (Healing Salve, Clarity, Tango). Effects of hero skills are AbilityImpls from F / G.
import { scaledRange } from '../core/config';
import type { CastTarget } from '../core/sim';
import type { AbilityDef } from '../core/types';
import { PathFlag, pathingAt } from '../core/map';
import { ABILITIES, ITEMS, levelValue } from '../data';
import { TUNABLES } from './tunables';
import type { PendingCast, SimHero, SimUnit } from './types';
import type { World } from './world';

type CastResult = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): CastResult => ({ ok: false, reason });

const valueOr = (def: AbilityDef, key: string, level: number, fallback: number): number => {
  const arr = def.values[key];
  return arr && arr.length > 0 ? levelValue(def, key, level) : fallback;
};

const isChargeAbility = (def: AbilityDef): boolean => def.kind !== 'item' && !!def.values.charges && !!def.values.chargeRestoreTime;

export const learnAbility = (w: World, unitId: number, abilityId: string): boolean => {
  const u = w.byId.get(unitId);
  const h = u?.hero as SimHero | undefined;
  if (!u || !h || h.skillPoints <= 0) return false;
  if (!h.def.skills.includes(abilityId)) return false;
  const def = ABILITIES[abilityId];
  if (!def) return false;
  const cur = h.skillLevels[abilityId] ?? 0;
  if (cur >= def.maxLevel) return false;
  const required = def.requiredLevels[Math.min(cur, def.requiredLevels.length - 1)] ?? 1;
  if (h.level < required) return false;
  h.skillLevels[abilityId] = cur + 1;
  h.skillPoints--;
  if (cur === 0 && isChargeAbility(def)) h.charges[abilityId] = levelValue(def, 'charges', 1);
  w.abilityContext(u, abilityId, cur + 1);
  w.markDirty(u);
  return true;
};

/** Item slot holding an item whose active is `abilityId` (-1 = none). */
const itemSlotFor = (h: SimHero, abilityId: string): number => h.items.findIndex((id) => !!id && ITEMS[id]?.active === abilityId);

/** Built-in consumable effects (used when no AbilityImpl is registered for the id). */
const BUILTIN: Record<string, (w: World, caster: SimUnit, def: AbilityDef, target: CastTarget) => void> = {
  item_healing_salve: (w, caster, def, target) => {
    const t = (target.targetId !== undefined ? w.byId.get(target.targetId) : undefined) ?? caster;
    const dur = levelValue(def, 'duration', 1);
    w.addBuff(t.id, { id: def.id, sourceId: caster.id, expiresAt: w.time + dur, hpPerSecond: levelValue(def, 'totalHeal', 1) / dur, dispelOnDamage: true } as never);
  },
  item_clarity: (w, caster, def) => {
    const dur = levelValue(def, 'duration', 1);
    w.addBuff(caster.id, { id: def.id, sourceId: caster.id, expiresAt: w.time + dur, manaPerSecond: levelValue(def, 'totalMana', 1) / dur, dispelOnDamage: true } as never);
  },
  item_tango: (w, caster, def) => {
    const dur = levelValue(def, 'duration', 1);
    w.addBuff(caster.id, { id: def.id, sourceId: caster.id, expiresAt: w.time + dur, hpPerSecond: levelValue(def, 'totalHeal', 1) / dur } as never);
  },
};

const treeNear = (w: World, x: number, y: number, radius: number): { x: number; y: number } | null => {
  const step = 32;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      const d = dx * dx + dy * dy;
      if (d > radius * radius || d >= bestD) continue;
      if (pathingAt(w.map, x + dx, y + dy) & PathFlag.Tree) {
        bestD = d;
        best = { x: x + dx, y: y + dy };
      }
    }
  }
  return best;
};

export const castAbility = (w: World, unitId: number, abilityId: string, target: CastTarget): CastResult => {
  const u = w.byId.get(unitId);
  if (!u || !u.alive) return fail('dead');
  const def = ABILITIES[abilityId];
  if (!def) return fail('unknown ability');
  const h = u.hero as SimHero | undefined;

  let level = 0;
  let itemSlot = -1;
  if (def.kind === 'item') {
    if (!h) return fail('no inventory');
    itemSlot = itemSlotFor(h, abilityId);
    if (itemSlot < 0) return fail('no item');
    level = 1;
  } else if (h) {
    level = h.skillLevels[abilityId] ?? 0;
    if (level <= 0 && u.def.abilities.includes(abilityId) && !h.def.skills.includes(abilityId)) level = 1;
    if (level <= 0) return fail('not learned');
  } else {
    if (!u.def.abilities.includes(abilityId)) return fail('not learned');
    level = 1;
  }

  if (w.isStunned(u)) return fail('stunned');
  if (def.kind !== 'item' && w.isSilenced(u)) return fail('silenced');
  if (u.pendingCast) return fail('busy');

  const cooldowns = h?.cooldownReadyAt;
  if (cooldowns && (cooldowns[abilityId] ?? -Infinity) > w.time) return fail('cooldown');
  const mana = levelValue(def, 'manaCost', level);
  if (u.mana < mana) return fail('mana');
  if (h && isChargeAbility(def) && (h.charges[abilityId] ?? 0) <= 0) return fail('charges');

  const impl = w.impls.get(abilityId);
  const builtin = BUILTIN[abilityId];
  if (!impl?.cast && !builtin) return fail('not implemented');

  // Targeting and range.
  const t = target.targetId !== undefined ? w.byId.get(target.targetId) : undefined;
  if ((def.targeting === 'unit' || def.targeting === 'hero') && abilityId !== 'item_healing_salve') {
    if (!t || !t.alive) return fail('invalid target');
    if (def.targeting === 'hero' && !t.hero) return fail('invalid target');
  }
  let resolved: CastTarget = target;
  if (abilityId === 'item_tango') {
    const range = scaledRange(levelValue(def, 'castRange', 1)) + TUNABLES.tangoTreeSearch;
    const at = target.point ?? { x: u.position.x, y: u.position.y };
    const tree = treeNear(w, at.x, at.y, target.point ? TUNABLES.tangoTreeSearch : range);
    if (!tree) return fail('no tree');
    if (Math.hypot(tree.x - u.position.x, tree.y - u.position.y) > range) return fail('out of range');
    resolved = { point: tree };
  } else {
    const range = scaledRange(levelValue(def, 'castRange', level));
    if (range > 0 && def.targeting !== 'none' && def.targeting !== 'self') {
      const p = t ? t.position : target.point;
      if (p) {
        const d = Math.hypot(p.x - u.position.x, p.y - u.position.y) - (t ? t.def.collisionRadius : 0);
        if (d > range + scaledRange(TUNABLES.castRangeBuffer)) return fail('out of range');
      }
    }
  }

  const pending: PendingCast = { abilityId, level, target: resolved, resolveAt: w.time + def.castPoint, itemSlot };
  if (def.castPoint <= 0) resolveCast(w, u, pending);
  else {
    u.pendingCast = pending;
    u.attackPhase = 0;
  }
  return { ok: true };
};

/** The cast point passed: pay mana / cooldown / charge / item charge, then run the effect. */
const resolveCast = (w: World, u: SimUnit, c: PendingCast): void => {
  const def = ABILITIES[c.abilityId]!;
  const h = u.hero as SimHero | undefined;
  const mana = levelValue(def, 'manaCost', c.level);
  if (u.mana < mana) return;
  if (c.itemSlot >= 0 && h && h.items[c.itemSlot] && ITEMS[h.items[c.itemSlot]!]?.active !== c.abilityId) return;
  u.mana -= mana;
  const cd = valueOr(def, 'cooldown', c.level, 0);
  if (h && cd > 0) h.cooldownReadyAt[c.abilityId] = w.time + cd;
  if (h && isChargeAbility(def)) {
    h.charges[c.abilityId] = Math.max(0, (h.charges[c.abilityId] ?? 0) - 1);
    if (h.chargeRestoreAt[c.abilityId] === undefined) h.chargeRestoreAt[c.abilityId] = w.time + levelValue(def, 'chargeRestoreTime', c.level);
  }
  if (h && c.itemSlot >= 0) consumeItemCharge(h, c.itemSlot);
  w.breakInvisibility(u);

  const impl = w.impls.get(c.abilityId);
  if (impl?.cast) {
    const ctx = w.abilityContext(u, c.abilityId, c.level);
    if (ctx) impl.cast(ctx, c.target);
  } else {
    BUILTIN[c.abilityId]?.(w, u, def, c.target);
  }
  const p = c.target.point;
  w.events.emit('ability:cast', {
    unitId: u.id,
    abilityId: c.abilityId,
    target: p ? { x: p.x, y: p.y, z: u.position.z } : undefined,
    targetId: c.target.targetId,
  });
};

/** Consumables lose one charge per use and vanish at 0. Non-consumables (itemCharges 0) are untouched. */
const consumeItemCharge = (h: SimHero, slot: number): void => {
  const charges = h.itemCharges[slot] ?? 0;
  if (charges <= 0) return;
  if (charges <= 1) {
    h.items[slot] = null;
    h.itemCharges[slot] = 0;
  } else {
    h.itemCharges[slot] = charges - 1;
  }
};

/** Pending casts, charge regeneration and AbilityImpl.tick for learned / innate abilities. */
export const tickAbilities = (w: World, dt: number): void => {
  for (const u of w.unitList) {
    if (!u.alive) continue;
    if (u.pendingCast) {
      if (w.isStunned(u)) u.pendingCast = null;
      else if (w.time >= u.pendingCast.resolveAt) {
        const c = u.pendingCast;
        u.pendingCast = null;
        resolveCast(w, u, c);
      }
    }
    const h = u.hero as SimHero | undefined;
    if (h) {
      for (const id in h.chargeRestoreAt) {
        const at = h.chargeRestoreAt[id]!;
        if (w.time < at) continue;
        const def = ABILITIES[id]!;
        const lv = Math.max(1, h.skillLevels[id] ?? 1);
        const max = levelValue(def, 'charges', lv);
        h.charges[id] = Math.min(max, (h.charges[id] ?? 0) + 1);
        if (h.charges[id]! < max) h.chargeRestoreAt[id] = at + levelValue(def, 'chargeRestoreTime', lv);
        else delete h.chargeRestoreAt[id];
      }
      for (const id in h.skillLevels) {
        const level = h.skillLevels[id]!;
        if (level <= 0) continue;
        const impl = w.impls.get(id);
        if (!impl?.tick) continue;
        const ctx = w.abilityContext(u, id, level);
        if (ctx) impl.tick(ctx, dt);
      }
    } else if (u.def.abilities.length > 0 && w.impls.size > 0) {
      for (const id of u.def.abilities) {
        const impl = w.impls.get(id);
        if (!impl?.tick) continue;
        const ctx = w.abilityContext(u, id, 1);
        if (ctx) impl.tick(ctx, dt);
      }
    }
  }
};
