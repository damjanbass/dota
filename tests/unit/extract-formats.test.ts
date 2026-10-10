// Unit checks for the map-extraction building blocks (no source map needed).
import { describe, expect, it } from 'vitest';
import { decryptBytes, hashString, HashType } from '../../tools/extract-map/mpq/crypto';
import { parseProfileKey, parseSlk } from '../../tools/extract-map/formats/profile';
import { groundZ, waterZ } from '../../tools/extract-map/formats/w3e';
import { rawcode } from '../../tools/extract-map/formats/jass';

describe('MPQ crypto', () => {
  it('matches the well-known Storm table keys', () => {
    // Constants from StormLib (MPQ_KEY_HASH_TABLE / MPQ_KEY_BLOCK_TABLE).
    expect(hashString('(hash table)', HashType.FileKey)).toBe(0xc3af3770);
    expect(hashString('(block table)', HashType.FileKey)).toBe(0xec83b3a3);
  });

  it('decrypts data encrypted with the same key schedule', () => {
    // Encrypt by running the decrypt keystream "backwards": Storm encryption XORs the same stream.
    const plain = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const key = hashString('war3map.j', HashType.FileKey);
    const enc = encrypt(plain, key);
    expect(enc.subarray(0, 8)).not.toEqual(plain.subarray(0, 8));
    decryptBytes(enc, key);
    expect(enc).toEqual(plain);
  });
});

describe('w3e height formulas', () => {
  it('uses (groundHeight − 0x2000 + (layer − 2) × 0x200) / 4', () => {
    expect(groundZ(0x2000, 2)).toBe(0);
    expect(groundZ(0x2000 + 512, 2)).toBe(128);
    expect(groundZ(0x2000, 3)).toBe(128);
    expect(waterZ(0x2000)).toBeCloseTo(-89.6);
  });
});

describe('text tables', () => {
  it('parses SYLK cells with carried-over coordinates', () => {
    const slk = 'ID;PWXL;N;E\nC;X1;Y1;K"unitID"\nC;X2;K"level"\nC;Y2;X1;K"hfoo"\nC;X2;K2\nC;Y3;X1;K"ugho"\nC;X2;K1\nE';
    const t = parseSlk(slk);
    expect(t.get('hfoo')?.get('level')).toBe('2');
    expect(t.get('ugho')?.get('level')).toBe('1');
  });

  it('reads the first Name per section', () => {
    const names = parseProfileKey(['[n00L]\r\nName="Roshan"\r\n[e00R]\r\nName=Ancient Protector - level 1\r\n'], 'Name');
    expect(names.get('n00L')).toBe('Roshan');
    expect(names.get('e00R')).toBe('Ancient Protector - level 1');
  });

  it('decodes integer rawcodes', () => {
    expect(rawcode('1848651852')).toBe('n00L');
    expect(rawcode("'hfoo'")).toBe('hfoo');
  });
});

// Storm encryption, written independently from decryptBytes for the round-trip test.
const encrypt = (plain: Uint8Array, key: number): Uint8Array => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let a = 0; a < 0x100; a++) {
    for (let i = 0, b = a; i < 5; i++, b += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const hi = (seed & 0xffff) << 0x10;
      seed = (seed * 125 + 3) % 0x2aaaab;
      table[b] = (hi | (seed & 0xffff)) >>> 0;
    }
  }
  const out = plain.slice();
  const view = new DataView(out.buffer);
  let s = 0xeeeeeeee;
  let k = key >>> 0;
  for (let o = 0; o + 4 <= out.length; o += 4) {
    s = (s + table[0x400 + (k & 0xff)]!) >>> 0;
    const ch = view.getUint32(o, true);
    view.setUint32(o, (ch ^ ((k + s) >>> 0)) >>> 0, true);
    k = ((((~k << 0x15) >>> 0) + 0x11111111) | (k >>> 0x0b)) >>> 0;
    s = (ch + s + ((s << 5) >>> 0) + 3) >>> 0;
  }
  return out;
};
