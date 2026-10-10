// Script facts → MapEntity list + lane polylines.
import { groundHeightAt } from '../../../src/core/map';
import type { LoadedMap, MapEntity, MapEntityKind } from '../../../src/core/map';
import type { Lane, Team, Tier, Vec2 } from '../../../src/core/types';
import { rectCenter } from '../formats/jass';
import type { PreplacedUnit, ScriptFacts } from '../formats/jass';
import type { SlkTable } from '../formats/profile';
import { NavGrid, projectOnPolyline } from './nav';

/**
 * Preplaced building kinds by WC3 rawcode. Names in comments come from the map's Units\*Strings.txt.
 * Melee/ranged barracks were confirmed from the script: the death trigger of each barracks clears
 * the flag that upgrades the *enemy* creeps spawned at the melee (Treant/Ghoul, range 100) or the
 * ranged (Druid of the Talon/Necromancer, range 500) rect of the same lane.
 */
const KIND_BY_TYPE: Record<string, MapEntityKind> = {
  etol: 'ancient', // The World Tree
  unpl: 'ancient', // The Frozen Throne
  nfoh: 'fountain', // Well of Life
  ndfl: 'fountain', // Defiled Fountain of Life
  eaom: 'barracks_melee', // Ancient of War
  usep: 'barracks_melee', // Crypt
  eaoe: 'barracks_ranged', // Ancient of Lore
  utod: 'barracks_ranged', // Temple of the Damned
  e00R: 'tower', // Ancient Protector - level 1
  e011: 'tower', // Ancient Protector - level 2
  e00S: 'tower', // Ancient Protector - level 3
  e019: 'tower', // Ancient Protector - level 4
  u00M: 'tower', // Spirit Tower - level 1
  u00D: 'tower', // Spirit Tower - level 2
  u00N: 'tower', // Spirit Tower - level 3
  u00T: 'tower', // Spirit Tower - level 4
  uC74: 'secret_shop', // Leragas The Vile
  u010: 'side_shop', // Goblin Merchant
  u00Z: 'side_shop', // Goblin Laboratory
  n0EO: 'tavern', // Dummy Tavern (re-created by the script as the 12 hero taverns)
  nC38: 'shop', // Sena The Accessorizer
  n01K: 'shop', // Weapons Dealer
  n009: 'shop', // Gateway Relics
  n00X: 'shop', // Enchanted Artifacts
  n00V: 'shop', // Arcane Sanctum
  n00W: 'shop', // Ancient Weaponry
  n002: 'shop', // Supportive Vestments
  n0HE: 'shop', // Protectorate
  e025: 'shop', // Ancient of Wonders (Sentinel)
  hC95: 'shop', // Cache of the Quel'thelan (Sentinel)
  nC35: 'shop', // Demonic Artifacts (Scourge)
  u00Q: 'shop', // Tomb of Relics (Scourge)
};

const MELEE_MAX_RANGE = 150;
const CAMP_SIZES = ['small', 'medium', 'large', 'ancient'] as const;

export interface EntityInput {
  facts: ScriptFacts;
  names: Map<string, string>;
  balance: SlkTable;
  weapons: SlkTable;
  map: LoadedMap;
  nav: NavGrid;
}

export interface EntityBuild {
  entities: MapEntity[];
  lanes: Record<Lane, Vec2[]>;
  /** Lane polylines without the base legs (spawn → bend → enemy spawn), used for classification. */
  coreLanes: Record<Lane, Vec2[]>;
  warnings: string[];
  /** 'other' entities by name, for the summary. */
  unclassified: Map<string, number>;
}

const LANES: Lane[] = ['top', 'mid', 'bot'];
const r1 = (v: number): number => Math.round(v * 10) / 10;
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const buildEntities = ({ facts, names, balance, weapons, map, nav }: EntityInput): EntityBuild => {
  const warnings: string[] = [];
  const entities: MapEntity[] = [];
  const nameOf = (id: string): string => names.get(id) ?? id;
  const add = (e: Omit<MapEntity, 'id' | 'z'>): MapEntity => {
    const full: MapEntity = { id: entities.length + 1, z: r1(groundHeightAt(map, e.x, e.y)), ...e };
    entities.push(full);
    return full;
  };
  const unitByVar = new Map<string, PreplacedUnit>();
  for (const u of facts.preplaced) if (u.varName) unitByVar.set(u.varName, u);
  const posOfLoc = (loc: string): Vec2 | undefined => {
    const u = unitByVar.get(facts.locToUnit.get(loc) ?? '');
    if (u) return { x: u.x, y: u.y };
    const r = facts.rects.get(facts.locToRect.get(loc) ?? '');
    return r && rectCenter(r);
  };
  const teamOfOwner = (owner: string): Team | undefined => {
    const p = facts.playerVars.get(owner);
    return p === undefined ? undefined : p <= 5 ? 'sentinel' : p <= 11 ? 'scourge' : undefined;
  };

  // --- lane routing from the creep order triggers -----------------------------------------
  const laneDummyVars = new Set<string>();
  const bendLocs = new Set<string>();
  const rectRoute = new Map<string, { team: Team; loc: string }>();
  let baseTarget: Partial<Record<Team, Vec2>> = {};
  for (const t of facts.orderTriggers) {
    for (const u of t.units) laneDummyVars.add(u);
    for (const o of t.orders) {
      const v = facts.locToUnit.get(o.loc);
      if (v) laneDummyVars.add(v);
      const team = teamOfOwner(o.owner);
      if (!team) continue;
      if (t.rects.length) {
        bendLocs.add(o.loc);
        for (const r of t.rects) rectRoute.set(r, { team, loc: o.loc });
      } else if (t.units.length) {
        // "Within range of a bend dummy → attack-move to the enemy base": the final target of `team`.
        const p = posOfLoc(o.loc);
        if (p) baseTarget = { ...baseTarget, [team]: p };
      }
    }
  }
  const bends = [...bendLocs].map((loc) => ({ loc, p: posOfLoc(loc) })).filter((b): b is { loc: string; p: Vec2 } => !!b.p);
  const laneOfLoc = new Map<string, Lane>();
  if (bends.length === 3) {
    // Top bend is the north-west corner, bottom bend the south-east corner, the third is mid.
    const top = bends.reduce((a, b) => (b.p.y - b.p.x > a.p.y - a.p.x ? b : a));
    const bot = bends.reduce((a, b) => (b.p.x - b.p.y > a.p.x - a.p.y ? b : a));
    laneOfLoc.set(top.loc, 'top');
    laneOfLoc.set(bot.loc, 'bot');
    for (const b of bends) if (!laneOfLoc.has(b.loc)) laneOfLoc.set(b.loc, 'mid');
  } else {
    warnings.push(`expected 3 lane bend points in the script, found ${bends.length}`);
  }
  const bendPos = new Map<Lane, Vec2>();
  for (const b of bends) bendPos.set(laneOfLoc.get(b.loc)!, b.p);

  // --- creep wave spawn rects -------------------------------------------------------------
  const isMeleeType = (id: string): boolean => Number(weapons.get(id)?.get('rangeN1') ?? NaN) <= MELEE_MAX_RANGE;
  const waveRects = new Map<string, { team: Team; types: Set<string> }>();
  for (const w of facts.waveSpawns) {
    if (/^\d+$/.test(w.count)) continue; // literal counts = one-off event spawns, not the regular waves
    const team = teamOfOwner(w.owner);
    if (!team) continue;
    const entry = waveRects.get(w.rect) ?? { team, types: new Set<string>() };
    entry.types.add(w.typeId);
    waveRects.set(w.rect, entry);
  }
  const spawnRect: Record<Team, Partial<Record<Lane, { melee?: Vec2; ranged?: Vec2 }>>> = { sentinel: {}, scourge: {}, neutral: {} };
  for (const [rect, w] of waveRects) {
    const route = rectRoute.get(rect);
    const lane = route && laneOfLoc.get(route.loc);
    const r = facts.rects.get(rect);
    if (!lane || !r) {
      warnings.push(`wave spawn rect ${rect} has no lane route`);
      continue;
    }
    const slot = (spawnRect[w.team][lane] ??= {});
    if ([...w.types].every(isMeleeType)) slot.melee = rectCenter(r);
    else slot.ranged = rectCenter(r);
  }

  // --- lane polylines: enemy-base target ← spawn → bend → enemy spawn → base target -----------
  const lanes = { top: [], mid: [], bot: [] } as Record<Lane, Vec2[]>;
  const coreLanes = { top: [], mid: [], bot: [] } as Record<Lane, Vec2[]>;
  const leg = (a: Vec2, b: Vec2): Vec2[] => {
    const cells = nav.findPath(a, b);
    if (!cells) {
      warnings.push(`no walkable path from (${a.x},${a.y}) to (${b.x},${b.y})`);
      return [a, b];
    }
    return nav.simplify(cells);
  };
  const join = (parts: Vec2[][]): Vec2[] => {
    const out: Vec2[] = [];
    for (const part of parts) for (const p of part) if (!out.length || dist(out[out.length - 1]!, p) > 1) out.push(p);
    return out;
  };
  for (const lane of LANES) {
    const s = spawnRect.sentinel[lane]?.melee;
    const u = spawnRect.scourge[lane]?.melee;
    const bend = bendPos.get(lane);
    if (!s || !u || !bend) {
      warnings.push(`lane ${lane}: missing spawn or bend point`);
      continue;
    }
    const core = join([leg(s, bend), leg(bend, u)]);
    coreLanes[lane] = core;
    // Scourge creeps finish at the Sentinel-base target and vice versa.
    const sentinelBase = baseTarget.scourge;
    const scourgeBase = baseTarget.sentinel;
    lanes[lane] = join([sentinelBase ? leg(sentinelBase, s) : [], core, scourgeBase ? leg(u, scourgeBase) : []]).map((p) => ({ x: r1(p.x), y: r1(p.y) }));
  }

  // --- preplaced buildings ----------------------------------------------------------------
  const ancients = facts.preplaced.filter((u) => KIND_BY_TYPE[u.typeId] === 'ancient');
  const ancientSentinel = ancients.reduce<PreplacedUnit | undefined>((a, b) => (!a || b.x + b.y < a.x + a.y ? b : a), undefined);
  const ancientScourge = ancients.reduce<PreplacedUnit | undefined>((a, b) => (!a || b.x + b.y > a.x + a.y ? b : a), undefined);
  if (!ancientSentinel || !ancientScourge || ancientSentinel === ancientScourge) throw new Error('Could not find both Ancients in the script');
  const teamByPosition = (p: Vec2): Team => (dist(p, ancientSentinel) <= dist(p, ancientScourge) ? 'sentinel' : 'scourge');
  const slotTeam = (player: number): Team => (player <= 5 ? 'sentinel' : player <= 11 ? 'scourge' : 'neutral');
  const unclassified = new Map<string, number>();

  for (const u of facts.preplaced) {
    if (laneDummyVars.has(u.varName)) continue;
    const rebuild = u.varName ? facts.rebuilds.get(u.varName) : undefined;
    const typeId = rebuild?.typeId ?? u.typeId;
    const kind = KIND_BY_TYPE[u.typeId] ?? 'other';
    const team: Team = kind === 'tavern' ? 'neutral' : teamByPosition(u);
    const owner = slotTeam(u.player);
    if (owner !== 'neutral' && owner !== team) warnings.push(`${nameOf(typeId)} at (${u.x},${u.y}): slot says ${owner}, position says ${team}`);
    const name = nameOf(typeId);
    if (kind === 'other') unclassified.set(name, (unclassified.get(name) ?? 0) + 1);
    const facing = Math.round((((rebuild?.facingDeg ?? u.facingDeg) * Math.PI) / 180) * 1e4) / 1e4;
    add({ kind, team, x: u.x, y: u.y, facing, typeId, name });
  }

  // Towers: tier 4 = the two closest to their own Ancient; others by order along their lane.
  for (const team of ['sentinel', 'scourge'] as const) {
    const anc = team === 'sentinel' ? ancientSentinel : ancientScourge;
    const towers = entities.filter((e) => e.kind === 'tower' && e.team === team).sort((a, b) => dist(a, anc) - dist(b, anc));
    towers.slice(0, 2).forEach((t) => (t.tier = 4));
    const byLane = new Map<Lane, Array<{ e: MapEntity; along: number }>>();
    for (const t of towers.slice(2)) {
      let best: { lane: Lane; dist: number; along: number } | undefined;
      for (const lane of LANES) {
        if (coreLanes[lane].length < 2) continue;
        const pr = projectOnPolyline(t, coreLanes[lane]);
        if (!best || pr.dist < best.dist) best = { lane, ...pr };
      }
      if (!best) continue;
      t.lane = best.lane;
      const list = byLane.get(best.lane) ?? [];
      list.push({ e: t, along: best.along });
      byLane.set(best.lane, list);
    }
    for (const [lane, list] of byLane) {
      // Lane arc length runs Sentinel → Scourge; a team's tier 3 is the one nearest its own end.
      list.sort((a, b) => (team === 'sentinel' ? a.along - b.along : b.along - a.along));
      if (list.length !== 3) warnings.push(`${team} ${lane}: ${list.length} towers (expected 3)`);
      list.forEach(({ e }, i) => (e.tier = (3 - i) as Tier));
    }
    for (const t of towers) {
      const level = /level (\d)/.exec(t.name)?.[1];
      if (level && Number(level) !== t.tier) warnings.push(`${t.name} at (${t.x},${t.y}) got tier ${t.tier} by lane order`);
    }
  }

  // Barracks: lane of the nearest regular wave spawn rect of the same team.
  for (const e of entities) {
    if (e.kind !== 'barracks_melee' && e.kind !== 'barracks_ranged') continue;
    let best: { lane: Lane; d: number } | undefined;
    for (const lane of LANES) {
      const slot = spawnRect[e.team][lane];
      for (const p of [slot?.melee, slot?.ranged]) if (p && (!best || dist(e, p) < best.d)) best = { lane, d: dist(e, p) };
    }
    if (best) e.lane = best.lane;
  }

  // --- markers ------------------------------------------------------------------------------
  for (const team of ['sentinel', 'scourge'] as const) {
    for (const lane of LANES) {
      const slot = spawnRect[team][lane];
      if (!slot?.melee) continue;
      const meta = slot.ranged ? { rangedX: slot.ranged.x, rangedY: slot.ranged.y } : undefined;
      add({ kind: 'creep_spawn', team, lane, x: slot.melee.x, y: slot.melee.y, facing: 0, typeId: '', name: `${team} ${lane} creep spawn`, ...(meta && { meta }) });
    }
  }

  // Hero spawn: per team, the rect centre used by the most hero-creating functions.
  const heroBest = new Map<Team, { rect: string; n: number }>();
  for (const [rect, n] of facts.heroSpawnRects) {
    const r = facts.rects.get(rect);
    if (!r) continue;
    const team = teamByPosition(rectCenter(r));
    const cur = heroBest.get(team);
    if (!cur || n > cur.n) heroBest.set(team, { rect, n });
  }
  for (const [team, { rect }] of heroBest) {
    const c = rectCenter(facts.rects.get(rect)!);
    add({ kind: 'hero_spawn', team, x: c.x, y: c.y, facing: 0, typeId: '', name: `${team} hero spawn` });
  }

  // Neutral camps: group spawners by their random option sets, rank groups by average total level.
  const level = (id: string): number => Number(balance.get(id)?.get('level') ?? 0);
  const groups = new Map<string, { strength: number; camps: typeof facts.camps }>();
  for (const camp of facts.camps) {
    const key = JSON.stringify(camp.options);
    const strength = camp.options.reduce((s, o) => s + o.reduce((t, id) => t + level(id), 0), 0) / Math.max(1, camp.options.length);
    const g = groups.get(key) ?? { strength, camps: [] };
    g.camps.push(camp);
    groups.set(key, g);
  }
  const ranked = [...groups.values()].sort((a, b) => a.strength - b.strength);
  if (ranked.length !== CAMP_SIZES.length) warnings.push(`expected ${CAMP_SIZES.length} camp difficulty groups, found ${ranked.length}`);
  ranked.forEach((g, i) => {
    const size = CAMP_SIZES[Math.min(CAMP_SIZES.length - 1, Math.round((i * (CAMP_SIZES.length - 1)) / Math.max(1, ranked.length - 1)))]!;
    for (const camp of g.camps) {
      const c = rectCenter(facts.rects.get(camp.rect)!);
      add({ kind: 'neutral_camp', team: 'neutral', x: c.x, y: c.y, facing: 0, typeId: '', name: `${size} camp`, meta: { size, strength: r1(g.strength) } });
    }
  });

  for (const rect of facts.runeRects) {
    const c = rectCenter(facts.rects.get(rect)!);
    add({ kind: 'rune_spot', team: 'neutral', x: c.x, y: c.y, facing: 0, typeId: '', name: 'Rune spot' });
  }

  const seen = new Set<string>();
  for (const s of facts.neutralLocSpawns) {
    if (seen.has(s.rect + s.typeId)) continue;
    seen.add(s.rect + s.typeId);
    const c = rectCenter(facts.rects.get(s.rect)!);
    const name = nameOf(s.typeId);
    const kind: MapEntityKind = name === 'Roshan' ? 'roshan' : 'other';
    if (kind === 'other') unclassified.set(name, (unclassified.get(name) ?? 0) + 1);
    add({ kind, team: 'neutral', x: c.x, y: c.y, facing: 0, typeId: s.typeId, name });
  }

  return { entities, lanes, coreLanes, warnings, unclassified };
};
