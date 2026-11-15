export class Lru<K, V> {
  private cur = new Map<K, V>();
  private old = new Map<K, V>();
  constructor(private limit: number) {}

  get(key: K): V | undefined {
    const v = this.cur.get(key);
    if (v !== undefined) return v;
    const o = this.old.get(key);
    if (o !== undefined) this.set(key, o);
    return o;
  }

  set(key: K, value: V): void {
    this.cur.set(key, value);
    if (this.cur.size >= this.limit) {
      this.old = this.cur;
      this.cur = new Map();
    }
  }
}
