import type { GenerateRequest, GenerateResult, LLMProvider } from '@bizr/ai';
import { getPack } from '@bizr/packs';

import { compileChangePlan } from '../change-plan/compile';
import { planFromPack } from '../change-plan/from-pack';
import { buildModel, type CompileContext } from '../semantic/model';
import type { AskCatalog } from './catalog';

/** Test fixtures for the ask module (not exported from the package). */

const pack = getPack('retail');

/** The Fernwood demo workspace, as `loadAskContext` would describe it. */
export function fixtureCatalog(unavailable: Record<string, string> = {}): AskCatalog {
  const values: Record<string, string[]> = {
    'product.name': [
      'Sage Stoneware Mug',
      'Linen Napkin Set',
      'Beeswax Candle',
      'Oak Serving Board',
    ],
    'product.category': ['Mugs', 'Table Linen', 'Candles', 'Kitchen'],
    'customer.name': ['Bloom & Co', 'Jane Smith', 'The Corner Shop'],
    'sale.channel': ['online_store', 'etsy', 'in_store', 'wholesale'],
    'expense.category': ['Advertising', 'Rent', 'Packaging', 'Software'],
    'supplier.name': ['Clayworks Ltd', 'Northern Linen'],
  };
  return {
    metrics: pack.metrics.metrics.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      format: m.format,
      snapshot: m.snapshot,
      available: !(m.id in unavailable),
      ...(unavailable[m.id] ? { reason: unavailable[m.id] } : {}),
      synonyms: [...m.synonyms, m.label.toLowerCase()],
      ...(m.default_time ? { defaultTime: m.default_time } : {}),
    })),
    dimensions: pack.metrics.dimensions
      .filter((d) => d.field in values)
      .map((d) => ({
        field: d.field,
        label: d.label,
        synonyms: d.synonyms,
        values: values[d.field] ?? [],
        valueSynonyms: pack.synonyms.values[d.field] ?? {},
        valueLabels: d.value_labels,
        noun: d.noun ?? ['result', 'results'],
      })),
    calendar: { today: '2026-10-13', weekStart: 1, fiscalYearStartMonth: 1 },
    currency: 'GBP',
  };
}

const { catalog: entities } = compileChangePlan(
  't_abcdefghij',
  [],
  planFromPack(
    pack,
    pack.entities.map((e) => e.id),
  ),
);
export const fixtureModel = buildModel(entities, pack);
export const fixtureCompile: CompileContext = {
  timezone: 'Europe/London',
  weekStart: 1,
  fiscalYearStartMonth: 1,
  today: '2026-10-13',
};

/** In-memory provider: answers each task from a queue, records every request. Never calls the API. */
export class FakeProvider implements LLMProvider {
  readonly calls: GenerateRequest<unknown>[] = [];
  /** Task → queued answers (output data, or an Error to throw). */
  constructor(private readonly answers: Record<string, unknown[]>) {}
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    this.calls.push(request);
    const next = this.answers[request.task]?.shift();
    if (next === undefined) return Promise.reject(new Error(`unexpected call to ${request.task}`));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      data: request.schema.parse(next),
      model: 'fake',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0,
      latencyMs: 0,
      replayed: false,
    });
  }
}
