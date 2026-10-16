import { entity, field, getAppDb, metric } from '@bizr/db';
import { getPack, type MetricFormat } from '@bizr/packs';
import { and, eq } from 'drizzle-orm';

import type { MemberWorkspace } from '../workspaces/service';
import { compileContext, loadSemanticModel } from '../semantic/service';
import type { SemanticModel } from '../semantic/model';
import type { Calendar } from './time';

/**
 * What the interpreters know about a workspace: its measures (with availability), the breakdowns
 * it can be split by, and the common values of those breakdowns. Values come from the owner's data
 * (untrusted): they go to the AI only inside <workspace_data>.
 */
export interface AskCatalog {
  metrics: {
    id: string;
    label: string;
    description: string;
    format: MetricFormat;
    snapshot: boolean;
    available: boolean;
    reason?: string;
    synonyms: string[];
    defaultTime?: string;
  }[];
  dimensions: {
    field: string;
    label: string;
    synonyms: string[];
    values: string[];
    /** Canonical value → words owners use for it (from the pack), e.g. online_store → website. */
    valueSynonyms: Record<string, string[]>;
    /** Display names for coded values (from the pack), e.g. online_store → Website. */
    valueLabels: Record<string, string>;
    /** How answers count it: ["product", "products"]. */
    noun: [string, string];
  }[];
  calendar: Calendar;
  currency: string;
}

export interface AskContext {
  catalog: AskCatalog;
  model: SemanticModel;
}

export async function loadAskContext(member: MemberWorkspace): Promise<AskContext> {
  const ws = member.workspace;
  const pack = getPack(ws.packId);
  const model = await loadSemanticModel(ws);
  const db = getAppDb();
  const metrics = await db.select().from(metric).where(eq(metric.workspaceId, ws.id));
  const values = await db
    .select({
      entity: entity.key,
      field: field.key,
      values: field.topValues,
      hasData: field.hasData,
    })
    .from(field)
    .innerJoin(entity, eq(entity.id, field.entityId))
    .where(and(eq(entity.workspaceId, ws.id), eq(field.hasData, true)));
  const ctx = compileContext(member);
  const byRef = new Map(values.map((v) => [`${v.entity}.${v.field}`, v.values]));
  return {
    model,
    catalog: {
      metrics: pack.metrics.metrics.map((m) => {
        const row = metrics.find((r) => r.key === m.id);
        return {
          id: m.id,
          label: row?.label ?? m.label,
          description: m.description,
          format: m.format,
          snapshot: m.snapshot,
          available: row?.available ?? false,
          ...(row?.unavailableReason ? { reason: row.unavailableReason } : {}),
          synonyms: [...m.synonyms, (row?.label ?? m.label).toLowerCase()],
          ...(m.default_time ? { defaultTime: m.default_time } : {}),
        };
      }),
      dimensions: pack.metrics.dimensions
        .filter((d) => byRef.has(d.field))
        .map((d) => ({
          field: d.field,
          label: d.label,
          synonyms: d.synonyms,
          values: byRef.get(d.field) ?? [],
          valueSynonyms: pack.synonyms.values[d.field] ?? {},
          valueLabels: d.value_labels,
          noun: d.noun ?? ['result', 'results'],
        })),
      calendar: {
        today: ctx.today,
        weekStart: ctx.weekStart,
        fiscalYearStartMonth: ctx.fiscalYearStartMonth,
      },
      currency: member.settings.currency,
    },
  };
}
