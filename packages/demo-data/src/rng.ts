/** Small, fast, deterministic PRNG (mulberry32). Same seed → same dataset on every machine. */
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks by non-negative weights. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weight(item));
    if (total <= 0) throw new Error('all weights are zero');
    let r = this.next() * total;
    for (const item of items) {
      r -= Math.max(0, weight(item));
      if (r < 0) return item;
    }
    return items[items.length - 1]!;
  }

  /** Poisson-distributed count (Knuth; fine for the small means we use). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    const l = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= this.next();
    } while (p > l);
    return k - 1;
  }
}
