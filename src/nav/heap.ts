// Binary min-heap of (id, key) pairs on typed arrays. Decrease-key is done lazily by pushing duplicates;
// callers skip stale entries when popping.
export class MinHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;

  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(id: number, key: number): void {
    if (this.size === this.ids.length) this.grow();
    const ids = this.ids;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pk = keys[parent]!;
      if (pk <= key) break;
      ids[i] = ids[parent]!;
      keys[i] = pk;
      i = parent;
    }
    ids[i] = id;
    keys[i] = key;
  }

  /** Key of the minimum entry (Infinity when empty). */
  peekKey(): number {
    return this.size > 0 ? this.keys[0]! : Infinity;
  }

  /** Removes and returns the id with the smallest key. Undefined behaviour when empty. */
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0]!;
    const n = --this.size;
    if (n > 0) {
      const id = ids[n]!;
      const key = keys[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1]! < keys[c]!) c++;
        if (keys[c]! >= key) break;
        ids[i] = ids[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }

  private grow(): void {
    const ids = new Int32Array(this.ids.length * 2);
    const keys = new Float64Array(this.keys.length * 2);
    ids.set(this.ids);
    keys.set(this.keys);
    this.ids = ids;
    this.keys = keys;
  }
}
