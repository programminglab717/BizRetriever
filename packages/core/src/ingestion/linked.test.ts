import { describe, expect, it } from 'vitest';

import { changedFromApproved } from './linked';
import type { ModelProposal } from './proposal';

const mapping = {
  sourceId: 's1',
  decision: 'map',
  entity: 'order',
  columns: [{ column: 'Total', field: 'total', rules: [] }],
} as unknown as ModelProposal['sources'][number];

const proposal = (over: Partial<ModelProposal> = {}): ModelProposal => ({
  sources: [mapping],
  dedupe: [],
  questions: [],
  assumptions: [],
  ...over,
});

/** Security review, M13: an automatic linked import is only ever the mappings the owner approved. */
describe('changedFromApproved', () => {
  it('carries on when the proposal is exactly what was approved, keys in any order', () => {
    const fromDb = { ...JSON.parse(JSON.stringify(mapping)) } as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(fromDb).reverse());
    expect(
      changedFromApproved(
        proposal(),
        proposal({ sources: [reordered as ModelProposal['sources'][number]] }),
      ),
    ).toBeNull();
  });

  it('waits when records would be treated as one', () => {
    const latest = proposal({
      dedupe: [
        { entity: 'customer', clusters: [{ canonical: 'Bloom & Co', variants: ['Bloom Co'] }] },
      ],
    });
    expect(changedFromApproved(latest, proposal())).toMatch(/same/);
  });

  it('waits when a sheet’s mapping changed since it was approved', () => {
    const revised = {
      ...mapping,
      columns: [{ column: 'Total', field: 'subtotal', rules: [] }],
    } as unknown as ModelProposal['sources'][number];
    expect(changedFromApproved(proposal({ sources: [revised] }), proposal())).toMatch(/mapping/);
  });
});
