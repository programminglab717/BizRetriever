/**
 * `pnpm demo:generate [--today YYYY-MM-DD] [--seed N] [--out DIR] [--next-month DIR] [--pack wholesale]`
 * Writes the Fernwood Home & Gift demo files (DEMO_SCRIPT §3) plus ground_truth.json. With
 * `--next-month`, also writes next month's website export there (for trying a re-upload). With
 * `--pack wholesale`, writes the Harbour & Pine Supply wholesale demo instead (M14).
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { generateDemoDataset, generateNextMonthUpdate, generateWholesaleDataset } from './index';

const { values } = parseArgs({
  options: {
    today: { type: 'string' },
    seed: { type: 'string', default: '42' },
    out: { type: 'string', default: '.data/demo/fernwood' },
    'next-month': { type: 'string' },
    pack: { type: 'string', default: 'retail' },
  },
});

const today = values.today ?? new Date().toISOString().slice(0, 10);
if (values.pack === 'wholesale') {
  const out = path.resolve(
    process.env.INIT_CWD ?? process.cwd(),
    values.out === '.data/demo/fernwood' ? '.data/demo/harbour' : values.out,
  );
  const t = await generateWholesaleDataset({ today, seed: Number(values.seed), outDir: out });
  console.log(`Harbour & Pine wholesale demo for ${today} written to ${out}`);
  for (const f of t.files) console.log(`  ${f.file} › ${f.sheet}: ${f.dataRows} rows`);
  console.log('Stories:');
  for (const [name, story] of Object.entries(t.stories))
    console.log(`  ${name}: ${JSON.stringify(story)}`);
  process.exit(0);
}
const outDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
const truth = await generateDemoDataset({ today, seed: Number(values.seed), outDir });
if (values['next-month']) {
  const nextDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), values['next-month']);
  const next = await generateNextMonthUpdate({ today, seed: Number(values.seed), outDir: nextDir });
  console.log(
    `Next month's website export (to ${next.today}) written to ${nextDir}: ${next.added.length} new orders, ${next.cancelled.length} cancelled, ${next.dropped.length} left out`,
  );
}

console.log(`Fernwood demo data for ${today} (seed ${truth.meta.seed}) written to ${outDir}`);
for (const f of truth.files) console.log(`  ${f.file} › ${f.sheet}: ${f.dataRows} rows`);
const s = truth.stories;
console.log('Stories:');
console.log(
  `  stock-out: ${String(s.stockoutRisk?.product)} — ${String(s.stockoutRisk?.daysOfCover)} days of cover`,
);
console.log(
  `  slipping customer: ${String(s.slippingCustomer?.customer)} — down ${String(s.slippingCustomer?.dropPct)}%`,
);
console.log(
  `  dead stock: ${String(s.deadStock?.count)} products, $${String(s.deadStock?.totalValueAtCost)} tied up`,
);
console.log(
  `  margin squeeze: ${String(s.marginSqueeze?.marginBeforePct)}% → ${String(s.marginSqueeze?.marginAfterPct)}%`,
);
console.log(`  return spike: ${String(s.returnSpike?.returnRatePct)}% of carafes returned`);
console.log(`  rising star: +${String(s.risingStar?.changePct)}%`);
console.log(
  `  etsy share: ${String(s.channelShift?.sharePctPrior90Days)}% → ${String(s.channelShift?.sharePctLast90Days)}%`,
);
console.log(
  `  overdue: ${JSON.stringify(s.overduePayments?.customers)} owe $${String(s.overduePayments?.totalOwed)}`,
);
