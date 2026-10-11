// Bottom-centre ability bar: Q Shrapnel (charges), E Take Aim, R Assassinate, F Town Portal and the
// Headshot passive. One small canvas per slot, redrawn only when its visible state changes.
import type { HeroState, UnitState } from '../core/sim';
import type { AbilityDef } from '../core/types';
import { ABILITIES, levelValue } from '../data';
import type { Action } from '../player/input';
import type { HudContext, HudPart } from './context';
import { cooldownFraction, formatCooldown } from './format';
import { abilityIcon } from './icons';
import type { AbilityIconKind } from './icons';
import { el } from './style';

interface SlotDef {
  abilityId: string;
  key: string;
  icon: AbilityIconKind;
  learn?: Action;
  learnKey?: string;
  passive?: boolean;
  /** Item that grants the ability (counted from the inventory). */
  itemId?: string;
}

export const ABILITY_SLOTS: readonly SlotDef[] = [
  { abilityId: 'sniper_shrapnel', key: 'Q', icon: 'shrapnel', learn: 'levelShrapnel', learnKey: 'Q' },
  { abilityId: 'sniper_take_aim', key: 'E', icon: 'take_aim', learn: 'levelTakeAim', learnKey: 'E' },
  { abilityId: 'sniper_assassinate', key: 'R', icon: 'assassinate', learn: 'levelAssassinate', learnKey: 'R' },
  { abilityId: 'item_tpscroll', key: 'F', icon: 'tp', itemId: 'tpscroll' },
  { abilityId: 'sniper_headshot', key: '', icon: 'headshot', learn: 'levelHeadshot', learnKey: 'G', passive: true },
];

/** Next level of the ability can be learned now. */
export const canLearn = (h: HeroState, def: AbilityDef): boolean => {
  if (h.skillPoints <= 0 || !h.def.skills.includes(def.id)) return false;
  const cur = h.skillLevels[def.id] ?? 0;
  if (cur >= def.maxLevel) return false;
  const req = def.requiredLevels[cur] ?? def.requiredLevels[def.requiredLevels.length - 1] ?? 1;
  return h.level >= req;
};

const ICON_PX = 128;

interface SlotView {
  def: SlotDef;
  ability: AbilityDef | undefined;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  pips: HTMLElement[];
  lastKey: string;
  lastPips: number;
  lastClass: string;
}

export const createAbilityBar = (ctx: HudContext, parent: HTMLElement, opts: { learnKeys: boolean }): HudPart => {
  const root = el('div', 'hud-abilities');
  const learnHint = el('div', 'hud-learn off');
  const slotsEl = el('div', 'hud-slots');
  root.append(learnHint, slotsEl);
  parent.appendChild(root);

  const learn = (abilityId: string): void => {
    const p = ctx.sim.player();
    ctx.sim.learnAbility(p.id, abilityId);
  };

  const views: SlotView[] = ABILITY_SLOTS.map((def) => {
    const ability = ABILITIES[def.abilityId];
    const slot = el('div', `hud-slot${def.passive ? ' passive' : ''}`);
    const canvas = el('canvas');
    canvas.width = ICON_PX;
    canvas.height = ICON_PX;
    const pipsEl = el('div', 'pips');
    const n = def.itemId ? 0 : (ability?.maxLevel ?? 0);
    const pips: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
      const p = el('i');
      pips.push(p);
      pipsEl.appendChild(p);
    }
    const plus = el('div', 'plus', '+');
    plus.title = `Learn ${ability?.name ?? def.abilityId} (Ctrl+${def.learnKey ?? ''})`;
    plus.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      learn(def.abilityId);
    });
    slot.append(canvas, pipsEl, plus);
    slotsEl.appendChild(slot);
    return { def, ability, root: slot, canvas, g: canvas.getContext('2d')!, pips, lastKey: '', lastPips: -1, lastClass: '' };
  });

  const onPress = (a: Action): void => {
    const slot = ABILITY_SLOTS.find((s) => s.learn === a);
    if (slot) learn(slot.abilityId);
  };
  if (opts.learnKeys) ctx.player.input.pressListeners.add(onPress);

  let lastHint = '';

  const draw = (v: SlotView, s: { learned: boolean; frac: number; cdText: string; noMana: boolean; charges: number; maxCharges: number; chargeText: string; count: number; scoped: boolean }): void => {
    const g = v.g;
    const S = ICON_PX;
    g.clearRect(0, 0, S, S);
    g.drawImage(abilityIcon(v.def.icon, S), 0, 0);
    if (!s.learned) {
      g.globalCompositeOperation = 'saturation';
      g.fillStyle = '#808080';
      g.fillRect(0, 0, S, S);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 0, S, S);
    }
    if (s.noMana && s.learned) {
      g.fillStyle = 'rgba(20, 50, 210, 0.5)';
      g.fillRect(0, 0, S, S);
    }
    if (s.frac > 0) {
      // WC3 sweep: the dark wedge shrinks clockwise from 12 o'clock.
      const start = -Math.PI / 2 + (1 - s.frac) * Math.PI * 2;
      g.fillStyle = 'rgba(0,0,0,0.68)';
      g.beginPath();
      g.moveTo(S / 2, S / 2);
      g.arc(S / 2, S / 2, S, start, Math.PI * 1.5);
      g.closePath();
      g.fill();
    }
    if (s.cdText) {
      g.font = `900 ${s.cdText.length > 2 ? 40 : 52}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.9)';
      g.strokeText(s.cdText, S / 2, S / 2 + 2);
      g.fillStyle = '#ffffff';
      g.fillText(s.cdText, S / 2, S / 2 + 2);
    }
    // Hotkey badge.
    if (v.def.key) {
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(0, 0, 34, 34);
      g.font = '900 24px "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = s.learned ? '#ffe27a' : '#9a8a60';
      g.fillText(v.def.key, 17, 18);
    }
    // Shrapnel charge pips + recharge timer.
    if (s.maxCharges > 0 && s.learned) {
      for (let i = 0; i < s.maxCharges; i++) {
        const x = 18 + i * 22;
        g.beginPath();
        g.arc(x, S - 16, 8, 0, Math.PI * 2);
        g.fillStyle = i < s.charges ? '#ffcf40' : 'rgba(0,0,0,0.75)';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = i < s.charges ? '#fff3c0' : '#7a6030';
        g.stroke();
      }
      if (s.chargeText) {
        g.font = '900 24px "Arial Black", sans-serif';
        g.textAlign = 'right';
        g.textBaseline = 'top';
        g.lineWidth = 5;
        g.strokeStyle = '#000';
        g.strokeText(s.chargeText, S - 6, 6);
        g.fillStyle = '#ffd860';
        g.fillText(s.chargeText, S - 6, 6);
      }
    }
    // Scroll count.
    if (v.def.itemId) {
      g.font = '900 30px "Arial Black", sans-serif';
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.lineWidth = 5;
      g.strokeStyle = '#000';
      g.strokeText(String(s.count), S - 6, S - 4);
      g.fillStyle = s.count > 0 ? '#fff' : '#ff6050';
      g.fillText(String(s.count), S - 6, S - 4);
    }
    if (v.def.passive) {
      g.font = 'bold 15px Verdana, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(0, S - 22, S, 22);
      g.fillStyle = '#d8d0c0';
      g.fillText('PASSIVE', S / 2, S - 4);
    }
  };

  const slotState = (v: SlotView, u: UnitState, h: HeroState, time: number) => {
    const id = v.def.abilityId;
    const a = v.ability;
    let learned: boolean;
    let level: number;
    let count = 0;
    if (v.def.itemId) {
      count = h.charges[id] ?? h.items.filter((x) => x === v.def.itemId).length;
      learned = count > 0;
      level = 1;
    } else {
      level = h.skillLevels[id] ?? 0;
      learned = level > 0;
    }
    const lv = Math.max(1, level);
    const maxCharges = a?.values.charges ? levelValue(a, 'charges', lv) : 0;
    const charges = maxCharges > 0 ? (h.charges[id] ?? (learned ? maxCharges : 0)) : 0;
    const readyAt = h.cooldownReadyAt[id] ?? -Infinity;
    const remaining = Math.max(0, readyAt - time);
    let frac = 0;
    let cdText = '';
    let chargeText = '';
    if (learned && a && !v.def.passive) {
      if (maxCharges > 0) {
        const restore = levelValue(a, 'chargeRestoreTime', lv);
        if (charges < maxCharges && remaining > 0) chargeText = formatCooldown(remaining);
        if (charges <= 0) {
          frac = cooldownFraction(remaining, restore);
          cdText = formatCooldown(remaining);
        }
      } else {
        frac = cooldownFraction(remaining, levelValue(a, 'cooldown', lv));
        cdText = formatCooldown(remaining);
      }
    }
    const mana = a && learned && !v.def.passive ? levelValue(a, 'manaCost', lv) : 0;
    const noMana = mana > 0 && u.mana < mana;
    return { learned, level, frac, cdText, noMana, charges, maxCharges, chargeText, count, scoped: ctx.player.scope.isScoped };
  };

  return {
    update() {
      const u = ctx.sim.player();
      const h = u.hero;
      if (!h) return;
      const time = ctx.sim.time;
      let anyLearnable = false;
      for (const v of views) {
        const s = slotState(v, u, h, time);
        const key = `${s.learned}|${s.cdText}|${Math.round(s.frac * 200)}|${s.noMana}|${s.charges}|${s.chargeText}|${s.count}`;
        if (key !== v.lastKey) {
          v.lastKey = key;
          draw(v, s);
        }
        if (s.level !== v.lastPips) {
          v.lastPips = s.level;
          v.pips.forEach((p, i) => p.classList.toggle('on', i < s.level));
        }
        const learnable = !!v.ability && !v.def.itemId && canLearn(h, v.ability);
        if (learnable) anyLearnable = true;
        const cls = `${learnable ? 'learnable' : ''}|${v.def.icon === 'take_aim' && s.learned && s.scoped ? 'glow' : ''}`;
        if (cls !== v.lastClass) {
          v.lastClass = cls;
          v.root.classList.toggle('learnable', learnable);
          v.root.classList.toggle('glow', cls.endsWith('glow'));
        }
      }
      const hint = anyLearnable ? `+ Skill point${h.skillPoints > 1 ? `s (${h.skillPoints})` : ''} — Ctrl+Q/E/R/G to learn` : '';
      if (hint !== lastHint) {
        lastHint = hint;
        learnHint.textContent = hint;
        learnHint.classList.toggle('off', !hint);
      }
    },
    dispose() {
      ctx.player.input.pressListeners.delete(onPress);
      root.remove();
    },
  };
};
