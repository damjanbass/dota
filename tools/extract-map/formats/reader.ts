// Little-endian cursor over a byte buffer (all WC3 map files are little-endian).
export class BinaryReader {
  offset = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Fixed-length ASCII id such as a 4-char rawcode. */
  chars(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.offset + i]!);
    this.offset += n;
    return s;
  }

  /** Null-terminated UTF-8 string. */
  cstring(): string {
    const start = this.offset;
    while (this.offset < this.bytes.byteLength && this.bytes[this.offset] !== 0) this.offset++;
    const s = new TextDecoder().decode(this.bytes.subarray(start, this.offset));
    this.offset++;
    return s;
  }

  skip(n: number): void {
    this.offset += n;
  }
}
