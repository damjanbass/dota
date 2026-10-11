// Top-right CS 1.6 kill feed ([killer] [icon] [victim]) and the centre announcer text.
import type { UnitState } from '../core/sim';
import type { UnitKind } from '../core/types';
import type { HudContext, HudPart } from './context';
import { GLYPHS } from './icons';
import { KillFeedQueue } from './killFeedQueue';
import type { KillFeedEntry, KillIcon } from './killFeedQueue';
import { el, esc } from './style';

const STRUCTURES: ReadonlySet<UnitKind> = new Set(['tower', 'barracks_melee', 'barracks_ranged', 'ancient']);
/** A headshot that lands this close to the death counts as the killing blow. */
const HEADSHOT_WINDOW = 0.75;

/** Which icon a kill line gets. Exported for tests / reuse. */
export const killIconFor = (killer: UnitState | undefined, denied: boolean, headshot: boolean, killerIsPlayer: boolean): KillIcon => {
  if (denied) return 'deny';
  if (!killer) return 'skull';
  if (killerIsPlayer) return headshot ? 'headshot' : 'rifle';
  if (headshot) return 'headshot';
  if (killer.kind === 'tower') return 'tower';
  if (killer.kind === 'creep_ranged' || killer.kind === 'creep_siege') return 'ranged';
  if (killer.hero) return killer.def.attackRange > 200 ? 'ranged' : 'melee';
  return 'melee';
};

const TEAM_NAME = { sentinel: 'Sentinel', scourge: 'Scourge', neutral: 'Neutral' } as const;

const RUNE_TEXT: Record<string, string> = {
  haste: 'Haste!',
  doubleDamage: 'Double Damage!',
  double_damage: 'Double Damage!',
  illusion: 'Illusion!',
  regeneration: 'Regeneration!',
  invisibility: 'Invisibility!',
  bounty: 'Bounty!',
};

const BIG_WORDS = /first blood|double kill|triple kill|ultra kill|rampage|killing spree|dominating|mega kill|unstoppable|wicked sick|monster kill|godlike|holy shit|victory|defeat/i;

interface Announcement {
  text: string;
  cls: string;
}

export const createKillFeed = (ctx: HudContext, parent: HTMLElement): HudPart => {
  const feed = el('div', 'hud-feed');
  const announce = el('div', 'hud-announce');
  parent.append(feed, announce);
  const q = new KillFeedQueue();
  let shownVersion = -1;
  const lastHeadshot = new Map<number, { by: number | null; at: number }>();
  let firstBloodPending = false;
  let firstBloodDone = false;
  const queue: Announcement[] = [];
  let showingUntil = 0;

  const playerId = (): number => ctx.sim.player().id;

  const unsub = [
    ctx.events.on('unit:damaged', (e) => {
      if (e.headshot) lastHeadshot.set(e.targetId, { by: e.sourceId, at: ctx.now() });
    }),
    ctx.events.on('unit:died', (e) => {
      const victim = ctx.sim.get(e.unitId);
      if (!victim) return;
      const killer = e.killerId !== null ? ctx.sim.get(e.killerId) : undefined;
      const pid = playerId();
      const killerIsPlayer = e.killerId === pid;
      const isStructure = STRUCTURES.has(victim.kind) || victim.kind === 'roshan';
      const relevant = !!victim.hero || isStructure || (e.denied && (killerIsPlayer || !!victim.hero));
      if (!relevant) return;
      const hs = lastHeadshot.get(e.unitId);
      const headshot = !!hs && hs.by === e.killerId && ctx.now() - hs.at < HEADSHOT_WINDOW;
      lastHeadshot.delete(e.unitId);
      const creepKill = killer && !killer.hero && !STRUCTURES.has(killer.kind) && killer.kind !== 'tower';
      const killerName = killer ? (creepKill ? `${TEAM_NAME[killer.team]} creeps` : ctx.unitName(killer)) : null;
      const entry = q.push(
        {
          killer: killerName,
          killerTeam: killer?.team ?? null,
          victim: ctx.unitName(victim),
          victimTeam: victim.team,
          icon: killIconFor(killer, e.denied, headshot, killerIsPlayer),
          tag: e.denied ? 'DENIED' : undefined,
          involvesPlayer: killerIsPlayer || e.unitId === pid,
        },
        ctx.now(),
      );
      if (victim.hero && !e.denied && killer?.hero && !firstBloodDone && firstBloodPending) {
        firstBloodPending = false;
        firstBloodDone = true;
        entry.tag = 'FIRST BLOOD';
      }
    }),
    ctx.events.on('announce', (e) => {
      if (/first blood/i.test(e.text) && !firstBloodDone) {
        const last = q.entries()[q.entries().length - 1];
        if (last && ctx.now() - last.at < 1 && !last.tag) {
          last.tag = 'FIRST BLOOD';
          firstBloodDone = true;
          q.version++;
        } else firstBloodPending = true;
      }
      queue.push({ text: e.text, cls: e.team ?? 'neutral' });
    }),
    ctx.events.on('rune:picked', (e) => {
      if (e.unitId !== playerId()) return;
      queue.push({ text: RUNE_TEXT[e.kind] ?? `${e.kind}!`, cls: 'neutral' });
    }),
  ];

  const renderLine = (e: KillFeedEntry): string => {
    const icon = GLYPHS[e.icon];
    const killer = e.killer ? `<span class="${e.killerTeam ?? 'neutral'}">${esc(e.killer)}</span>` : '';
    const tag = e.tag ? `<span class="tag${e.tag === 'FIRST BLOOD' ? ' fb' : ''}">${esc(e.tag)}</span>` : '';
    return `<div class="line${e.involvesPlayer ? ' me' : ''}">${killer}${icon}<span class="${e.victimTeam}">${esc(e.victim)}</span>${tag}</div>`;
  };

  return {
    update() {
      const now = ctx.now();
      q.prune(now);
      if (q.version !== shownVersion) {
        shownVersion = q.version;
        feed.innerHTML = q.entries().map(renderLine).join('');
      }
      if (queue.length && now >= showingUntil) {
        const a = queue.shift()!;
        const msg = el('div', `msg ${a.cls}`);
        if (BIG_WORDS.test(a.text) && a.text.length <= 22) msg.classList.add('big');
        if (a.text.length > 30) msg.classList.add('long');
        msg.textContent = a.text;
        announce.textContent = '';
        announce.appendChild(msg);
        // Back-to-back announcements (First Blood + Double Kill) get shorter slots.
        showingUntil = now + (queue.length ? 1.3 : 2.2);
      }
    },
    dispose() {
      for (const fn of unsub) fn();
      feed.remove();
      announce.remove();
    },
  };
};
