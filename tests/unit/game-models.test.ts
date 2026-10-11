import { describe, expect, it } from 'vitest';
import { UNITS } from '../../src/data';
import { modelIdFor } from '../../src/game/unitModels';

describe('every mobile unit in the data has a world model', () => {
  const mobile = Object.values(UNITS).filter((u) => u.moveSpeed > 0);
  it.each(mobile.map((u) => [u.id]))('%s resolves', (id) => {
    expect(modelIdFor(id)).not.toBeNull();
  });
});
