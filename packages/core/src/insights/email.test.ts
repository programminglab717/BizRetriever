import { describe, expect, it } from 'vitest';

import type { DigestContent } from './digest';
import {
  checkUnsubscribe,
  unsubscribeToken,
  urgentAlertEmail,
  weekLabel,
  weeklySummaryEmail,
  type EmailContext,
} from './email';

const W = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';
const ctx: EmailContext = {
  businessName: 'Fernwood <Home>',
  personName: 'Avery',
  baseUrl: 'https://app.test/w/fernwood',
  unsubscribeUrl: 'https://app.test/api/email/unsubscribe?w=1&t=x',
};

const digest: DigestContent = {
  weekOf: '2026-10-12',
  period: { from: '2026-10-05', to: '2026-10-12' },
  kpis: [
    {
      label: 'Net sales',
      value: '$4,210.50',
      previous: '$3,900.00',
      change: '+8%',
      direction: 'up',
      goodDirection: 'up',
    },
  ],
  insights: [{ id: 'a', text: '**Sage Mug** will run out in <b>3 days</b>', level: 'urgent' }],
  question: 'Which products made me the most profit last month?',
};

describe('weekLabel', () => {
  it('reads like a person wrote it', () => {
    expect(weekLabel({ from: '2026-10-05', to: '2026-10-12' })).toBe('5–11 Oct 2026');
    expect(weekLabel({ from: '2026-09-28', to: '2026-10-05' })).toBe('28 Sep – 4 Oct 2026');
    expect(weekLabel({ from: '2026-12-28', to: '2027-01-04' })).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});

describe('weeklySummaryEmail', () => {
  const e = weeklySummaryEmail('avery@example.test', digest, ctx);

  it('carries the numbers as the code formatted them, and the question', () => {
    expect(e.subject).toBe('Fernwood <Home>: your week of 5–11 Oct 2026');
    expect(e.text).toContain('Net sales: $4,210.50 (+8% on the week before)');
    expect(e.text).toContain('• Sage Mug will run out in <b>3 days</b>');
    expect(e.text).toContain('Try asking: “Which products made me the most profit last month?”');
    expect(e.text).toContain('https://app.test/w/fernwood/home');
  });

  it('escapes every value in the HTML (cell text is untrusted)', () => {
    expect(e.html).toContain('<strong>Sage Mug</strong> will run out in &lt;b&gt;3 days&lt;/b&gt;');
    expect(e.html).toContain('Fernwood &lt;Home&gt;');
    expect(e.html).not.toContain('<b>3 days</b>');
    expect(e.html).not.toContain('<Home>');
  });

  it('lists what was handed to this person, escaped', () => {
    const mine = weeklySummaryEmail(
      'avery@example.test',
      digest,
      ctx,
      [],
      ['**Linen Napkins** are selling <i>slower</i>'],
    );
    expect(mine.text).toContain('Handed to you:\n• Linen Napkins are selling <i>slower</i>');
    expect(mine.html).toContain(
      '<strong>Linen Napkins</strong> are selling &lt;i&gt;slower&lt;/i&gt;',
    );
    expect(e.text).not.toContain('Handed to you');
  });

  it('has a one-click unsubscribe', () => {
    expect(e.headers).toEqual({
      'List-Unsubscribe': `<${ctx.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(e.text).toContain(`Stop weekly summaries: ${ctx.unsubscribeUrl}`);
  });
});

describe('urgentAlertEmail', () => {
  it('names a single alert in the subject and sums up several', () => {
    const one = urgentAlertEmail('a@example.test', [{ text: '**Sage Mug** will run out' }], ctx);
    expect(one.subject).toBe('Fernwood <Home>: Sage Mug will run out');
    expect(one.text).toContain('Stop urgent alerts:');
    const many = urgentAlertEmail(
      'a@example.test',
      Array.from({ length: 7 }, (_, i) => ({ text: `Item ${i}` })),
      ctx,
    );
    expect(many.subject).toBe('Fernwood <Home>: 7 things need a look');
    expect(many.text).toContain('…and 2 more.');
    expect(many.text).not.toContain('Item 5');
  });
});

describe('unsubscribe links', () => {
  it('accepts only a genuine signature for that person, business and kind', () => {
    const t = unsubscribeToken(W, U, 'weekly_summary');
    expect(checkUnsubscribe({ w: W, u: U, k: 'weekly_summary', t })).toBe(true);
    expect(checkUnsubscribe({ w: W, u: U, k: 'urgent_alert', t })).toBe(false);
    expect(checkUnsubscribe({ w: U, u: W, k: 'weekly_summary', t })).toBe(false);
    expect(checkUnsubscribe({ w: W, u: U, k: 'weekly_summary', t: `${t}x` })).toBe(false);
    expect(checkUnsubscribe({ w: 'nope', u: U, k: 'weekly_summary', t })).toBe(false);
    expect(checkUnsubscribe({})).toBe(false);
  });
});
