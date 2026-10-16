import { describe, expect, it } from 'vitest';

import { checkDashboard, packDashboardFileSchema } from './dashboard';
import { getPack } from './registry';

const pack = getPack('retail');

describe('pack dashboards', () => {
  it('the retail dashboard is valid and starts with the headline numbers', () => {
    expect(checkDashboard(pack.metrics, pack.dashboard)).toEqual([]);
    expect(pack.dashboard.tiles.slice(0, 4).map((t) => t.chart)).toEqual([
      'kpi',
      'kpi',
      'kpi',
      'kpi',
    ]);
    expect(pack.dashboard.default_range).toEqual({ preset: 'last_30_days', compare: true });
  });

  it('reports unknown measures, breakdowns and inconsistent tiles', () => {
    const bad = packDashboardFileSchema.parse({
      default_range: { preset: 'last_30_days' },
      tiles: [
        { id: 'a', title: 'A', chart: 'kpi', size: [3, 2], spec: { metrics: ['nope'] } },
        {
          id: 'a',
          title: 'B',
          chart: 'table',
          size: [6, 4],
          auto_grain: true,
          spec: {
            metrics: ['net_sales'],
            dimensions: [{ field: 'product.colour' }],
            having: [{ metric: 'gross_profit', op: 'gt', value: 0 }],
          },
        },
      ],
    });
    expect(checkDashboard(pack.metrics, bad)).toEqual([
      'tile "a" uses unknown measure "nope"',
      'tile "a" is listed twice',
      'tile "a" breaks down by "product.colour", which isn\'t a pack breakdown',
      'tile "a" filters on "gross_profit" without showing it',
      'tile "a" has auto_grain but no time breakdown',
    ]);
  });
});
