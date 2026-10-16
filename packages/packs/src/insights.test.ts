import { describe, expect, it } from 'vitest';

import { getPack } from './registry';
import { checkInsights, packInsightsFileSchema, type PackInsightRule } from './insights';

const retail = getPack('retail');
const base = retail.insights.rules.find((r) => r.id === 'stockout_risk')!;
const problems = (patch: Partial<PackInsightRule>) =>
  checkInsights(retail.metrics, packInsightsFileSchema.parse({ rules: [{ ...base, ...patch }] }));

describe('pack insight rules', () => {
  it('ships every rule in VERTICAL_PACKS §2.7, valid against the measures', () => {
    expect(retail.insights.rules.map((r) => r.id)).toEqual([
      'stockout_risk',
      'dead_stock',
      'customer_slipping',
      'margin_squeeze',
      'return_spike',
      'rising_star',
      'sales_change',
      'channel_shift',
      'overdue_payments',
    ]);
    expect(checkInsights(retail.metrics, retail.insights)).toEqual([]);
  });

  it('catches unknown measures, questions, facts and thresholds', () => {
    expect(problems({ where: { lt: ['cover.nope', 1] } })[0]).toMatch(/doesn't ask for/);
    expect(problems({ where: { lt: ['other.days_of_cover', 1] } })[0]).toMatch(
      /unknown question "other"/,
    );
    expect(problems({ where: { lt: ['cover.days_of_cover', { threshold: 'x' }] } })[0]).toMatch(
      /unknown threshold/,
    );
    expect(problems({ template: 'Runs out in {{weeks}} weeks.' })[0]).toMatch(
      /unknown fact "weeks"/,
    );
    expect(problems({ template: 'Runs out in 3 weeks, {{product}}.' })[0]).toMatch(
      /number outside a placeholder/,
    );
    expect(problems({ where: { lt: ['cover.days_of_cover__prev', 1] } })[0]).toMatch(
      /no comparison/,
    );
    expect(problems({ facts: { ...base.facts, n: { count: true } } })[0]).toMatch(
      /only summary rules/,
    );
  });
});
