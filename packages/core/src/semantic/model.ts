import type { PackData, PackDimension, PackMetric, PackMetrics } from '@bizr/packs';

import type { CatalogEntity } from '../change-plan/compile';
import { LinkGraph } from './graph';

/**
 * Everything the compiler knows about one workspace: its record types (from the catalog), the pack's
 * metric definitions, and which details actually hold data (for availability).
 */
export interface SemanticModel {
  entities: readonly CatalogEntity[];
  metrics: ReadonlyMap<string, PackMetric>;
  expressions: PackMetrics['expressions'];
  filters: PackMetrics['filters'];
  dimensions: readonly PackDimension[];
  graph: LinkGraph;
  /**
   * `entity.field` refs that hold data. Undefined means "assume everything in the catalog does"
   * (used for compile-only checks).
   */
  present?: ReadonlySet<string>;
}

export function buildModel(
  entities: readonly CatalogEntity[],
  pack: Pick<PackData, 'metrics'>,
  present?: ReadonlySet<string>,
): SemanticModel {
  return {
    entities,
    metrics: new Map(pack.metrics.metrics.map((m) => [m.id, m])),
    expressions: pack.metrics.expressions,
    filters: pack.metrics.filters,
    dimensions: pack.metrics.dimensions,
    graph: new LinkGraph(entities, pack.metrics.join_paths),
    ...(present ? { present } : {}),
  };
}

export interface CompileContext {
  /** IANA time zone of the workspace. */
  timezone: string;
  /** ISO weekday the week starts on (1 = Monday … 7 = Sunday). */
  weekStart: number;
  fiscalYearStartMonth: number;
  /** Today in the workspace's time zone (YYYY-MM-DD). */
  today: string;
}
