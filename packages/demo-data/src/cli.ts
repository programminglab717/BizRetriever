/**
 * `pnpm demo:generate [--today YYYY-MM-DD] [--seed N] [--out DIR]`
 * Writes the Fernwood Home & Gift demo files (DEMO_SCRIPT §3) plus ground_truth.json.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';

import { generateDemoDataset } from './index';

const { values } = parseArgs({
  options: {
    today: { type: 'string' },
    seed: { type: 'string', default: '42' },
    out: { type: 'string', default: '.data/demo/fernwood' },
  },
});

const today = values.today ?? new Date().toISOString().slice(0, 10);
const outDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
const truth = await generateDemoDataset({ today, seed: Number(values.seed), outDir });

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
