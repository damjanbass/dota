// Simulation performance budget: a 30-minute headless match (no bot heroes) on the real 6.83d map in < 10 s.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/core/config';
import { createSim } from '../../src/sim';
import { loadRealMap, testConfig } from '../../src/sim/testing';

const DATA = fileURLToPath(new URL('../../public/data/', import.meta.url));

describe('simulation performance', () => {
  it('simulates 30 minutes in under 10 seconds and stays deterministic', () => {
    const map = loadRealMap(DATA);
    const sim = createSim(map, testConfig({ seed: 683 }));
    const ticks = Math.round((30 * 60 - sim.time) / SIM_DT);
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) sim.step(SIM_DT);
    const ms = performance.now() - t0;
    console.log(`30-minute match: ${ticks} ticks in ${ms.toFixed(0)} ms, ${sim.units().length} units at the end`);
    expect(sim.time).toBeGreaterThanOrEqual(1799.9);
    expect(ms).toBeLessThan(10_000);

    // Same seed, same result (first 3 minutes).
    const snapshot = (): string => {
      const s = createSim(map, testConfig({ seed: 7 }), { startTime: -1 });
      for (let i = 0; i < 180 * 30; i++) s.step(SIM_DT);
      return s
        .units()
        .map((u) => `${u.id}:${u.def.id}:${u.position.x.toFixed(2)},${u.position.y.toFixed(2)}:${u.hp.toFixed(2)}`)
        .join('|');
    };
    expect(snapshot()).toBe(snapshot());
  }, 60_000);
});
