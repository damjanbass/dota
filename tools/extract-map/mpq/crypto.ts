// MPQ hashing and table/file decryption (the classic Storm algorithm).
// Reference: StormLib (SBaseCommon.cpp) and mdx-m3-viewer src/parsers/mpq/crypto.ts.

export const HashType = {
  TableOffset: 0,
  NameA: 1,
  NameB: 2,
  FileKey: 3,
} as const;

const buildCryptTable = (): Uint32Array => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let index1 = 0; index1 < 0x100; index1++) {
    for (let i = 0, index2 = index1; i < 5; i++, index2 += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const temp1 = (seed & 0xffff) << 0x10;
      seed = (seed * 125 + 3) % 0x2aaaab;
      const temp2 = seed & 0xffff;
      table[index2] = (temp1 | temp2) >>> 0;
    }
  }
  return table;
};

const CRYPT_TABLE = buildCryptTable();

/** Storm string hash. Names are case-insensitive and use backslashes. */
export const hashString = (name: string, type: number): number => {
  let seed1 = 0x7fed7fed;
  let seed2 = 0xeeeeeeee;
  const upper = name.toUpperCase().replace(/\//g, '\\');
  for (let i = 0; i < upper.length; i++) {
    const ch = upper.charCodeAt(i) & 0xff;
    seed1 = (CRYPT_TABLE[type * 0x100 + ch]! ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed2 = (ch + seed1 + seed2 + ((seed2 << 5) >>> 0) + 3) >>> 0;
  }
  return seed1;
};

/** Decrypts whole little-endian dwords in place; trailing bytes (len % 4) stay as-is. */
export const decryptBytes = (bytes: Uint8Array, key: number): void => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let seed = 0xeeeeeeee;
  let k = key >>> 0;
  for (let o = 0; o + 4 <= bytes.byteLength; o += 4) {
    seed = (seed + CRYPT_TABLE[0x400 + (k & 0xff)]!) >>> 0;
    const ch = (view.getUint32(o, true) ^ ((k + seed) >>> 0)) >>> 0;
    k = ((((~k << 0x15) >>> 0) + 0x11111111) | (k >>> 0x0b)) >>> 0;
    seed = (ch + seed + ((seed << 5) >>> 0) + 3) >>> 0;
    view.setUint32(o, ch, true);
  }
};
