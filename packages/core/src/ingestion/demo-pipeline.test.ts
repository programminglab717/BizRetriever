import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { generateDemoDataset, type GroundTruth } from '@bizr/demo-data';
import { getPack } from '@bizr/packs';
import { beforeAll, describe, expect, it } from 'vitest';

import { planFromPack } from '../change-plan/from-pack';
import { analyzeFiles, type Analysis } from './analyze';
import { proposeHeuristically, type HeuristicResult } from './heuristic';
import { materialize, type EntitySpec, type MaterializeResult } from './materialize';
import { validateProposal } from './validate';
import { findJargon } from '../narration';

/**
 * The deterministic pipeline on the Fernwood demo files, checked against the generator's answer key.
 * This is the M2 acceptance bar for "every entity count matches the ground truth".
 */
const TODAY = '2026-10-13';
let truth: GroundTruth;
let analysis: Analysis;
let heuristic: HeuristicResult;
let result: MaterializeResult;

const pack = getPack('retail');
const specs: EntitySpec[] = planFromPack(
  pack,
  pack.entities.map((e) => e.id),
).ops.flatMap((o) =>
  o.op === 'create_entity'
    ? [{ key: o.key, label: o.label, fields: o.fields, naturalKeys: o.naturalKeys }]
    : [],
);

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fernwood-pipeline-'));
  truth = await generateDemoDataset({ today: TODAY, seed: 42, outDir: dir });
  const files = readdirSync(dir)
    .filter((f) => f !== 'ground_truth.json')
    .sort()
    .map((fileName) => ({ fileName, bytes: readFileSync(path.join(dir, fileName)) }));
  analysis = await analyzeFiles(files, { dateOrder: 'MDY', maskPii: true });
  heuristic = proposeHeuristically(analysis.profiled, { pack, dateOrder: 'MDY', today: TODAY });
  result = materialize(analysis.tables, heuristic.proposal, specs, { dateOrder: 'MDY' });
}, 60_000);

const count = (entity: string) => result.entities.get(entity)?.length ?? 0;
const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

describe('deterministic pipeline on the demo files', () => {
  it('maps every table', () => {
    const ignored = heuristic.proposal.sources.filter((s) => s.decision === 'ignore');
    expect(ignored, JSON.stringify(ignored)).toEqual([]);
    expect(heuristic.spotted.join('\n')).toMatch(/Shopify orders/);
  });

  it('produces a valid proposal in plain language', () => {
    const v = validateProposal(heuristic.proposal, { sources: analysis.profiled, pack });
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    const texts = [
      ...heuristic.proposal.assumptions.map((a) => a.text),
      ...heuristic.proposal.questions.flatMap((q) => [q.text, ...q.options.map((o) => o.label)]),
    ];
    for (const t of texts) expect(findJargon(t), t).toEqual([]);
  });

  it('finds every product, supplier, order and line', () => {
    const c = truth.counts as Record<string, number> & { salesByChannel: Record<string, number> };
    expect(count('product')).toBe(c.products);
    expect(count('supplier')).toBe(c.suppliers);
    expect(count('sale')).toBe(c.sales);
    expect(count('sale_line')).toBe(c.saleLines);
    const byChannel: Record<string, number> = {};
    for (const s of result.entities.get('sale')!) {
      const ch = text(s.fields.channel);
      byChannel[ch] = (byChannel[ch] ?? 0) + 1;
    }
    expect(byChannel).toEqual(c.salesByChannel);
  });

  it('finds returns, supplier orders, stock levels and expenses', () => {
    const c = truth.counts as Record<string, number>;
    expect(count('return')).toBe(c.returns);
    expect(count('purchase')).toBe(c.purchases);
    expect(count('purchase_line')).toBe(c.purchaseLines);
    expect(count('stock_count')).toBe(c.products);
    expect(count('expense')).toBe(c.expenseEntries);
  });

  it('merges customers across channels and spellings', () => {
    const c = truth.counts as Record<string, number>;
    expect(count('customer')).toBe(c.namedCustomers! + c.stockists!);
    const bloom = result.entities
      .get('customer')!
      .filter((x) => text(x.fields.name).toLowerCase().includes('bloom'));
    expect(bloom).toHaveLength(1);
  });

  it('asks about the Bloom & Co spellings and Etsy’s day-first dates', () => {
    const texts = heuristic.proposal.questions.map((q) => q.text).join('\n');
    expect(texts).toMatch(/Bloom/);
    expect(texts).toMatch(/day-first/);
    expect(heuristic.proposal.questions.length).toBeLessThanOrEqual(3);
  });

  it('reads the planted stories correctly from the cleaned records', () => {
    const products = result.entities.get('product')!;
    const mug = products.find((p) => p.fields.name === 'Sage Stoneware Mug')!;
    expect(mug.fields.category).toBe('Mugs & Cups');
    const mugIndex = products.indexOf(mug);
    const stock = result.entities.get('stock_count')!.find((s) => s.links.product === mugIndex)!;
    const s = truth.stories;
    expect(stock.fields.quantity_on_hand).toBe(s.stockoutRisk!.onHand);
  });

  it('links almost every sale item to a product, and reports the rest', () => {
    const refs = result.stats.references.find(
      (r) => r.entity === 'sale_line' && r.field === 'product',
    )!;
    expect(refs.matched / (refs.matched + refs.unmatched)).toBeGreaterThan(0.95);
    expect(refs.unmatchedExamples.join(' ')).toMatch(/Sage Mug|Sml/);
  });

  it('never treats the injection canary as anything but data', () => {
    expect(JSON.stringify(heuristic.proposal)).not.toMatch(/Ignore all previous/);
  });
});
