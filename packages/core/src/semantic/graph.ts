import type { JoinPath } from '@bizr/packs';

import type { CatalogEntity } from '../change-plan/compile';

/**
 * The link graph between record types (ARCHITECTURE §7). Edges are many-to-one links (a sale item
 * links to one sale), so following them from a base record type never multiplies rows: that is what
 * keeps totals from double counting.
 */

/** One hop: from `entity`, follow link field `field` to `target`. */
export interface Hop {
  entity: string;
  field: string;
  target: string;
}

export class SemanticError extends Error {
  /** `userMessage` is plain language, safe to show. */
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
  }
}

export class LinkGraph {
  readonly #entities: Map<string, CatalogEntity>;
  readonly #preferred: readonly JoinPath[];
  readonly #cache = new Map<string, Hop[] | null>();

  constructor(entities: readonly CatalogEntity[], preferred: readonly JoinPath[] = []) {
    this.#entities = new Map(entities.map((e) => [e.key, e]));
    this.#preferred = preferred;
  }

  entity(key: string): CatalogEntity | undefined {
    return this.#entities.get(key);
  }

  #hopsFrom(key: string): Hop[] {
    const e = this.#entities.get(key);
    return (e?.fields ?? [])
      .filter((f) => f.type === 'reference' && f.references && this.#entities.has(f.references))
      .map((f) => ({ entity: key, field: f.key, target: f.references! }));
  }

  /**
   * The links to follow from `from` to reach `to` ([] when they're the same), or null if `to` can't
   * be reached. Throws when two equally short routes exist and the pack doesn't say which to use.
   */
  path(from: string, to: string): Hop[] | null {
    const cacheKey = `${from}>${to}`;
    if (this.#cache.has(cacheKey)) return this.#cache.get(cacheKey)!;
    const result = this.#find(from, to);
    this.#cache.set(cacheKey, result);
    return result;
  }

  #find(from: string, to: string): Hop[] | null {
    if (from === to) return [];
    const preferred = this.#preferred.find((p) => p.from === from && p.to === to);
    if (preferred) {
      const hops: Hop[] = [];
      let at = from;
      for (const ref of preferred.via) {
        const [entity, field] = ref.split('.') as [string, string];
        const hop = this.#hopsFrom(at).find((h) => h.entity === entity && h.field === field);
        if (!hop) throw new Error(`Preferred path ${from}→${to} breaks at ${ref}`);
        hops.push(hop);
        at = hop.target;
      }
      if (at !== to) throw new Error(`Preferred path ${from}→${to} ends at ${at}`);
      return hops;
    }

    // Breadth-first search; count shortest routes to detect ambiguity.
    let frontier: Hop[][] = [[]];
    const seen = new Set([from]);
    while (frontier.length > 0) {
      const next: Hop[][] = [];
      const reached: Hop[][] = [];
      const reachedThisLevel = new Set<string>();
      for (const route of frontier) {
        const at = route.length === 0 ? from : route[route.length - 1]!.target;
        for (const hop of this.#hopsFrom(at)) {
          if (seen.has(hop.target)) continue;
          const extended = [...route, hop];
          if (hop.target === to) reached.push(extended);
          else next.push(extended);
          reachedThisLevel.add(hop.target);
        }
      }
      if (reached.length > 1) {
        throw new SemanticError(
          `Ambiguous link path ${from}→${to}: ${reached.map((r) => r.map((h) => `${h.entity}.${h.field}`).join('>')).join(' | ')}`,
          'There’s more than one way to connect those records, so we can’t be sure which you mean.',
        );
      }
      if (reached.length === 1) return reached[0]!;
      for (const t of reachedThisLevel) seen.add(t);
      frontier = next;
    }
    return null;
  }

  /** The record type a reference field links to. */
  target(entity: string, field: string): string | undefined {
    return this.#entities.get(entity)?.fields.find((f) => f.key === field)?.references;
  }

  /**
   * The date that places a record in time: its own time field, or, failing that, the one of the
   * nearest record it must belong to (a sale item is dated by its sale).
   */
  timeField(entity: string): { entity: string; field: string } | undefined {
    const visited = new Set<string>();
    let level = [entity];
    while (level.length > 0) {
      const next: string[] = [];
      for (const key of level) {
        if (visited.has(key)) continue;
        visited.add(key);
        const e = this.#entities.get(key);
        if (e?.timeField) return { entity: key, field: e.timeField };
        for (const f of e?.fields ?? []) {
          if (f.type === 'reference' && f.required && f.references) next.push(f.references);
        }
      }
      level = next;
    }
    return undefined;
  }
}
