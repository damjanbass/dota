// Minimal read-only MPQ (v0, as used by WC3 maps) reader that tolerates "protected" maps:
// the header is found by scanning 512-byte aligned offsets, header sizes / archive sizes /
// table sizes past EOF are ignored or clamped, and files are looked up by known name (no listfile).
// Format reference: StormLib docs (http://www.zezula.net/en/mpq/mpqformat.html) and
// mdx-m3-viewer src/parsers/mpq/*.
import { inflateSync } from 'node:zlib';
import { decryptBytes, hashString, HashType } from './crypto';

const MPQ_MAGIC = 0x1a51504d; // 'MPQ\x1A' little-endian
const HASH_EMPTY = 0xffffffff;
const HASH_DELETED = 0xfffffffe;

const FILE_IMPLODE = 0x00000100;
const FILE_COMPRESS = 0x00000200;
const FILE_ENCRYPTED = 0x00010000;
const FILE_FIX_KEY = 0x00020000;
const FILE_SINGLE_UNIT = 0x01000000;
const FILE_SECTOR_CRC = 0x04000000;
const FILE_EXISTS = 0x80000000;

// Compression mask byte (first byte of a compressed sector).
const COMP_HUFFMAN = 0x01;
const COMP_ZLIB = 0x02;
const COMP_PKWARE = 0x08;
const COMP_BZIP2 = 0x10;

interface HashEntry {
  nameA: number;
  nameB: number;
  blockIndex: number;
}

interface BlockEntry {
  filePos: number;
  compressedSize: number;
  fileSize: number;
  flags: number;
}

export interface MpqFileInfo {
  name: string;
  size: number;
  compressedSize: number;
  flags: number;
}

const readTable = (buf: Uint8Array, offset: number, entries: number, key: number): DataView => {
  const bytes = new Uint8Array(entries * 16);
  // Protected maps may declare tables that run past EOF; missing bytes stay zero.
  const end = Math.min(buf.byteLength, offset + entries * 16);
  if (offset < end) bytes.set(buf.subarray(offset, end));
  decryptBytes(bytes, key);
  return new DataView(bytes.buffer);
};

export class MpqArchive {
  readonly headerOffset: number;
  readonly sectorSize: number;
  private readonly buf: Uint8Array;
  private readonly hashes: HashEntry[] = [];
  private readonly blocks: BlockEntry[] = [];

  constructor(buf: Uint8Array) {
    this.buf = buf;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let headerOffset = -1;
    for (let o = 0; o + 32 <= buf.byteLength; o += 512) {
      if (view.getUint32(o, true) === MPQ_MAGIC) {
        headerOffset = o;
        break;
      }
    }
    if (headerOffset < 0) throw new Error('No MPQ header found');
    this.headerOffset = headerOffset;
    // WC3 reads every archive as format v0 regardless of the declared version/header size.
    const sectorShift = view.getUint16(headerOffset + 14, true);
    const hashPos = view.getUint32(headerOffset + 16, true);
    const blockPos = view.getUint32(headerOffset + 20, true);
    const hashCount = view.getUint32(headerOffset + 24, true);
    const blockCountDeclared = view.getUint32(headerOffset + 28, true);
    this.sectorSize = 512 * 2 ** sectorShift;

    const hashOffset = headerOffset + hashPos;
    const blockOffset = headerOffset + blockPos;
    const blockCount = Math.min(blockCountDeclared, Math.max(0, Math.floor((buf.byteLength - blockOffset) / 16)));

    const ht = readTable(buf, hashOffset, hashCount, hashString('(hash table)', HashType.FileKey));
    for (let i = 0; i < hashCount; i++) {
      this.hashes.push({
        nameA: ht.getUint32(i * 16, true),
        nameB: ht.getUint32(i * 16 + 4, true),
        blockIndex: ht.getUint32(i * 16 + 12, true),
      });
    }
    const bt = readTable(buf, blockOffset, blockCount, hashString('(block table)', HashType.FileKey));
    for (let i = 0; i < blockCount; i++) {
      this.blocks.push({
        filePos: bt.getUint32(i * 16, true),
        compressedSize: bt.getUint32(i * 16 + 4, true),
        fileSize: bt.getUint32(i * 16 + 8, true),
        flags: bt.getUint32(i * 16 + 12, true),
      });
    }
  }

  private findBlock(name: string): BlockEntry | undefined {
    const size = this.hashes.length;
    if (size === 0) return undefined;
    const start = hashString(name, HashType.TableOffset) % size;
    const nameA = hashString(name, HashType.NameA);
    const nameB = hashString(name, HashType.NameB);
    for (let n = 0; n < size; n++) {
      const h = this.hashes[(start + n) % size]!;
      if (h.blockIndex === HASH_EMPTY) return undefined;
      if (h.blockIndex === HASH_DELETED) continue;
      if (h.nameA === nameA && h.nameB === nameB) {
        const block = this.blocks[h.blockIndex];
        if (block && block.flags & FILE_EXISTS) return block;
      }
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.findBlock(name) !== undefined;
  }

  info(name: string): MpqFileInfo | undefined {
    const b = this.findBlock(name);
    return b && { name, size: b.fileSize, compressedSize: b.compressedSize, flags: b.flags };
  }

  /** Returns the decompressed file, or undefined if the name isn't in the archive. */
  read(name: string): Uint8Array | undefined {
    const block = this.findBlock(name);
    if (!block) return undefined;
    const base = name.slice(name.lastIndexOf('\\') + 1);
    let key = hashString(base, HashType.FileKey);
    if (block.flags & FILE_FIX_KEY) key = (((key + block.filePos) >>> 0) ^ block.fileSize) >>> 0;
    const start = this.headerOffset + block.filePos;
    const raw = this.buf.slice(start, start + block.compressedSize);
    const encrypted = (block.flags & FILE_ENCRYPTED) !== 0;
    const compressed = (block.flags & (FILE_COMPRESS | FILE_IMPLODE)) !== 0;

    if (block.flags & FILE_SINGLE_UNIT || !compressed) {
      if (block.flags & FILE_SINGLE_UNIT) {
        if (encrypted) decryptBytes(raw, key);
        return this.decompress(raw, block.fileSize, block.flags);
      }
      // Uncompressed multi-sector file: sectors are contiguous, each encrypted with key + index.
      const out = raw.slice(0, block.fileSize);
      if (encrypted) {
        for (let s = 0, o = 0; o < out.byteLength; s++, o += this.sectorSize) {
          decryptBytes(out.subarray(o, Math.min(out.byteLength, o + this.sectorSize)), key + s);
        }
      }
      return out;
    }

    const sectorCount = Math.ceil(block.fileSize / this.sectorSize);
    const tableEntries = sectorCount + 1 + (block.flags & FILE_SECTOR_CRC ? 1 : 0);
    const table = raw.slice(0, tableEntries * 4);
    if (encrypted) decryptBytes(table, (key - 1) >>> 0);
    const tv = new DataView(table.buffer);
    const out = new Uint8Array(block.fileSize);
    for (let s = 0; s < sectorCount; s++) {
      const a = tv.getUint32(s * 4, true);
      const b = tv.getUint32(s * 4 + 4, true);
      const sector = raw.slice(a, b);
      if (encrypted) decryptBytes(sector, (key + s) >>> 0);
      const expected = Math.min(this.sectorSize, block.fileSize - s * this.sectorSize);
      out.set(this.decompress(sector, expected, block.flags).subarray(0, expected), s * this.sectorSize);
    }
    return out;
  }

  // Every file this tool needs from DotA 6.83d is zlib-compressed. PKWARE implode and bzip2 are
  // detected and reported instead of silently returning garbage (add a decoder if a map needs one).
  private decompress(data: Uint8Array, expected: number, flags: number): Uint8Array {
    if (data.byteLength >= expected) return data.subarray(0, expected);
    if (flags & FILE_IMPLODE) throw new Error('PKWARE-imploded MPQ file (unsupported)');
    const mask = data[0]!;
    if (mask !== COMP_ZLIB) {
      const kind = mask & COMP_BZIP2 ? 'bzip2' : mask & COMP_PKWARE ? 'PKWARE' : mask & COMP_HUFFMAN ? 'Huffman' : 'unknown';
      throw new Error(`Unsupported MPQ compression ${kind} (mask 0x${mask.toString(16)})`);
    }
    return new Uint8Array(inflateSync(data.subarray(1)));
  }
}
