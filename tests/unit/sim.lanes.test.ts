// Simulation: creep waves, lane movement, towers, building order, super creeps and the match end.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/config';
import { createMockMap } from '../../src/core/mockMap';
import type { UnitState } from '../../src/core/sim';
import { createSim, waveComposition } from '../../src/sim';
import { loadRealMap, testConfig } from '../../src/sim/testing';
import type { SimUnit } from '../../src/sim/types';
import type { World } from '../../src/sim/world';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));

const run = (sim: { step(dt: number): void; time: number }, seconds: number): void => {
  const end = sim.time + seconds;
  while (sim.time < end - 1e-9) sim.step(SIM_DT);
};

const creeps = (sim: { units(): readonly UnitState[] }): UnitState[] =>
  sim.units().filter((u) => u.alive && (u.kind === 'creep_melee' || u.kind === 'creep_ranged' || u.kind === 'creep_siege'));

const probe = (sim: World, u: UnitState): boolean => sim.dealDamage({ sourceId: null, targetId: u.id, amount: 1, type: 'pure', isAttack: false }) > 0;
const kill = (sim: World, u: UnitState, killer: UnitState | null = null): void => sim.killUnit(u as SimUnit, (killer as SimUnit) ?? null);

describe('creep waves', () => {
  it('spawns the first wave at the horn: 3 melee + 1 ranged per lane per side', () => {
    const sim = createSim(createMockMap(), testConfig(), { startTime: -1, neutrals: false });
    let spawned = 0;
    sim.events.on('unit:spawned', ({ unitId }) => {
      if (sim.get(unitId)!.kind.startsWith('creep')) spawned++;
    });
    run(sim, 0.9);
    expect(creeps(sim)).toHaveLength(0);
    run(sim, 0.2);
    const list = creeps(sim);
    expect(list).toHaveLength(24);
    for (const team of ['sentinel', 'scourge'] as const) {
      for (const lane of ['top', 'mid', 'bot'] as const) {
        const group = list.filter((u) => u.team === team && u.lane === lane);
        expect(group.filter((u) => u.def.id === `${team}_creep_melee`)).toHaveLength(3);
        expect(group.filter((u) => u.def.id === `${team}_creep_ranged`)).toHaveLength(1);
      }
    }
    run(sim, 29.8);
    expect(spawned).toBe(24);
    run(sim, 0.2);
    expect(spawned).toBe(48);
  });

  it('follows the 6.83d composition table (siege every 7th wave, extra creeps later)', () => {
    expect(waveComposition(1, 0)).toEqual({ melee: 3, ranged: 1, siege: 0 });
    expect(waveComposition(7, 180)).toEqual({ melee: 3, ranged: 1, siege: 1 });
    expect(waveComposition(35, 1020)).toEqual({ melee: 4, ranged: 1, siege: 1 });
    expect(waveComposition(91, 2700)).toEqual({ melee: 5, ranged: 2, siege: 2 });
  });

  it('meets roughly in mid on the real map', () => {
    const map = loadRealMap(DATA);
    const sim = createSim(map, testConfig(), { startTime: -1, neutrals: false });
    let meet: { x: number; y: number; t: number } | null = null;
    sim.events.on('unit:attack', ({ sourceId, targetId }) => {
      const a = sim.get(sourceId)!;
      const b = sim.get(targetId)!;
      if (meet || a.lane !== 'mid' || b.lane !== 'mid' || !a.kind.startsWith('creep') || !b.kind.startsWith('creep')) return;
      meet = { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2, t: sim.time };
    });
    run(sim, 40);
    expect(meet).not.toBeNull();
    // Halfway point of the mid lane polyline.
    const pts = map.data.lanes.mid;
    const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
    let half = lens.reduce((s, l) => s + l, 0) / 2;
    let mid = pts[0]!;
    for (let i = 0; i < lens.length; i++) {
      if (half <= lens[i]!) {
        const f = half / lens[i]!;
        mid = { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * f, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * f };
        break;
      }
      half -= lens[i]!;
    }
    const m = meet as unknown as { x: number; y: number; t: number };
    expect(Math.hypot(m.x - mid.x, m.y - mid.y)).toBeLessThan(1500);
    expect(m.t).toBeGreaterThan(8);
    expect(m.t).toBeLessThan(35);
  });
});

describe('towers', () => {
  it('kill creeps that walk into range', () => {
    const map = createMockMap();
    const sim = createSim(map, testConfig(), { startTime: 1, neutrals: false, waves: false }) as World;
    const tower = sim.units().find((u) => u.kind === 'tower' && u.team === 'sentinel' && u.tier === 1 && u.lane === 'mid')!;
    const creep = sim.spawn('scourge_creep_melee', 'scourge', tower.position.x + 500, tower.position.y + 500);
    let killer: number | null = null;
    sim.events.on('unit:died', (e) => {
      if (e.unitId === creep.id) killer = e.killerId;
    });
    run(sim, 20);
    expect(creep.alive).toBe(false);
    expect(killer).toBe(tower.id);
  });

  it('switch to a hero that attacks an allied hero in range', () => {
    const sim = createSim(createMockMap(), testConfig({ enemies: ['pudge'] }), { startTime: 1, neutrals: false, waves: false }) as World;
    const tower = sim.units().find((u) => u.kind === 'tower' && u.team === 'scourge' && u.tier === 1 && u.lane === 'mid')! as SimUnit;
    const pudge = sim.units().find((u) => u.def.id === 'pudge')!;
    const player = sim.player();
    const creep = sim.spawn('sentinel_creep_melee', 'sentinel', tower.position.x - 300, tower.position.y - 300);
    sim.teleport(pudge.id, tower.position.x - 500, tower.position.y - 400);
    sim.teleport(player.id, tower.position.x - 700, tower.position.y - 600);
    run(sim, 1);
    expect(tower.targetId).toBe(creep.id);
    sim.events.emit('player:shot', {
      origin: player.position,
      direction: { x: 1, y: 0, z: 0 },
      result: { targetId: pudge.id, part: 'body', point: pudge.position, distance: 300, blockedBy: null },
    });
    expect(tower.targetId).toBe(player.id);
  });

  it('open in the 6.83d order: T1 → T2 → T3 → barracks/T4 → Ancient', () => {
    const sim = createSim(createMockMap(), testConfig(), { startTime: -5, neutrals: false, waves: false }) as World;
    const of = (pred: (u: UnitState) => boolean): UnitState[] => sim.units().filter((u) => u.team === 'scourge' && pred(u));
    const tower = (tier: number, lane?: string): UnitState => of((u) => u.kind === 'tower' && u.tier === tier && (lane === undefined || u.lane === lane))[0]!;
    const t1 = tower(1, 'top');
    expect(probe(sim, t1)).toBe(false);
    run(sim, 5.1);
    expect(probe(sim, t1)).toBe(true);
    const t2 = tower(2, 'top');
    const t3 = tower(3, 'top');
    const rax = of((u) => u.kind === 'barracks_melee' && u.lane === 'top')[0]!;
    const t4s = of((u) => u.kind === 'tower' && u.tier === 4);
    const ancient = of((u) => u.kind === 'ancient')[0]!;
    expect(probe(sim, t2)).toBe(false);
    kill(sim, t1);
    expect(probe(sim, t2)).toBe(true);
    expect(probe(sim, t3)).toBe(false);
    kill(sim, t2);
    expect(probe(sim, t3)).toBe(true);
    expect(probe(sim, rax)).toBe(false);
    expect(probe(sim, t4s[0]!)).toBe(false);
    kill(sim, t3);
    expect(probe(sim, rax)).toBe(true);
    expect(probe(sim, t4s[0]!)).toBe(true);
    expect(probe(sim, ancient)).toBe(false);
    // Other lanes stay closed.
    expect(probe(sim, of((u) => u.kind === 'barracks_melee' && u.lane === 'mid')[0]!)).toBe(false);
    kill(sim, t4s[0]!);
    expect(probe(sim, ancient)).toBe(false);
    kill(sim, t4s[1]!);
    expect(probe(sim, ancient)).toBe(true);
  });

  it('backdoor protection heals 25% of hero damage without enemy creeps nearby', () => {
    const sim = createSim(createMockMap(), testConfig(), { startTime: 1, neutrals: false, waves: false }) as World;
    const t2 = sim.units().find((u) => u.kind === 'tower' && u.team === 'scourge' && u.tier === 2 && u.lane === 'mid')!;
    (t2 as SimUnit).baseInvulnerable = false;
    const dealt = sim.dealDamage({ sourceId: sim.player().id, targetId: t2.id, amount: 100, type: 'pure', isAttack: false });
    expect(dealt).toBeCloseTo(75, 5);
  });
});

describe('barracks and the Ancient', () => {
  it('a destroyed melee barracks makes that lane spawn super melee creeps; all six → mega creeps', () => {
    const sim = createSim(createMockMap(), testConfig(), { startTime: 1, neutrals: false }) as World;
    const rax = sim.units().filter((u) => u.team === 'scourge' && (u.kind === 'barracks_melee' || u.kind === 'barracks_ranged'));
    kill(sim, rax.find((u) => u.kind === 'barracks_melee' && u.lane === 'mid')!);
    run(sim, 30);
    const wave = creeps(sim).filter((u) => u.team === 'sentinel');
    const ids = (lane: string): string[] => wave.filter((u) => u.lane === lane).map((u) => u.def.id);
    expect(ids('mid').filter((id) => id === 'sentinel_creep_melee_super')).toHaveLength(3);
    expect(ids('mid')).toContain('sentinel_creep_ranged');
    expect(ids('top').filter((id) => id === 'sentinel_creep_melee')).toHaveLength(3);
    for (const r of rax) if (r.alive) kill(sim, r);
    run(sim, 30);
    const megas = creeps(sim).filter((u) => u.team === 'sentinel' && u.def.id.endsWith('_mega'));
    expect(megas.length).toBeGreaterThanOrEqual(12);
  });

  it('destroying an Ancient ends the match', () => {
    const sim = createSim(createMockMap(), testConfig(), { startTime: 1, neutrals: false, waves: false }) as World;
    let winner: string | null = null;
    sim.events.on('match:ended', (e) => {
      winner = e.winner;
    });
    const ancient = sim.units().find((u) => u.kind === 'ancient' && u.team === 'scourge')!;
    const destroyed: Array<number | null> = [];
    sim.events.on('building:destroyed', (e) => destroyed.push(e.entityId));
    kill(sim, ancient, sim.player());
    expect(winner).toBe('sentinel');
    expect(sim.winner).toBe('sentinel');
    expect(destroyed).toEqual([ancient.entityId]);
  });
});
