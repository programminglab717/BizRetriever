import type { GenerateRequest, GenerateResult, LLMProvider } from '@bizr/ai';
import { AiError } from '@bizr/ai';
import { getPack, type PackInsightRule } from '@bizr/packs';
import { describe, expect, it } from 'vitest';

import { phraseInsights, phrasingProblems, withPackBold } from './phrase';

const pack = getPack('retail');
const rule = (id: string): PackInsightRule => pack.insights.rules.find((r) => r.id === id)!;

function fake(reply: (alerts: { id: string; template: string }[]) => unknown): LLMProvider & {
  seen: string[];
} {
  const seen: string[] = [];
  return {
    seen,
    generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
      const content = String(request.messages[0]!.content);
      seen.push(request.system, content);
      const alerts = JSON.parse(/<alerts>\n(.*)\n<\/alerts>/s.exec(content)![1]!) as {
        id: string;
        template: string;
      }[];
      return Promise.resolve({
        data: request.schema.parse(reply(alerts)),
        model: 'fake',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        latencyMs: 0,
        replayed: true,
      });
    },
  };
}

describe('Task J: rewording insights', () => {
  const stock = rule('stockout_risk').template;

  it('accepts a rewording with the same placeholders, and puts the bold back', () => {
    const text =
      'At {{rate}} a day, {{product}} runs out in about {{days}} {{days|day|days}}. {{on_hand}} left in stock.';
    expect(phrasingProblems(text, stock)).toEqual([]);
    expect(withPackBold(text, stock)).toBe(
      'At {{rate}} a day, **{{product}}** runs out in about {{days}} {{days|day|days}}. {{on_hand}} left in stock.',
    );
  });

  it('refuses numbers, lost or invented placeholders, advice, markup and jargon', () => {
    const p = (t: string) => phrasingProblems(t, stock).join('; ');
    expect(p('{{product}} runs out in 6 days ({{rate}}, {{days}}, {{on_hand}}).')).toMatch(
      /number outside/,
    );
    expect(p('{{product}} is running low at {{rate}} a day.')).toMatch(/keep the placeholder/);
    expect(p('{{product}} {{days}} {{rate}} {{on_hand}} {{supplier}}.')).toMatch(/unknown/);
    expect(p('{{product}} runs out in {{days}} because of {{rate}}; {{on_hand}} left.')).toMatch(
      /explain why/,
    );
    expect(p('**{{product}}** runs out in {{days}} at {{rate}}; {{on_hand}} left.')).toMatch(
      /markup/,
    );
    expect(p('Your {{product}} row runs out in {{days}} at {{rate}}; {{on_hand}} left.')).toMatch(
      /technical words/,
    );
  });

  it('sends only pack text, keeps what passes and drops what fails', async () => {
    const provider = fake((alerts) => ({
      items: alerts.map((a) => ({
        id: a.id,
        text: a.id === 'b' ? 'Sold out in 3 days.' : a.template.replace('at the current', 'at the'),
      })),
    }));
    const out = await phraseInsights(
      [
        { id: 'a', rule: rule('stockout_risk') },
        { id: 'b', rule: rule('dead_stock') },
      ],
      provider,
      'ws',
    );
    expect([...out.keys()]).toEqual(['a']);
    expect(out.get('a')).toContain('**{{product}}** will run out');
    expect(provider.seen.join('\n')).not.toMatch(
      /Sage|Bloom|\{\{product\}\} will run out in about 6/,
    );
  });

  it('keeps the pack sentences when the AI is unavailable', async () => {
    const down: LLMProvider = {
      generate: () => Promise.reject(new AiError('down', 'Our AI helper is resting.')),
    };
    expect((await phraseInsights([{ id: 'a', rule: rule('dead_stock') }], down, 'ws')).size).toBe(
      0,
    );
    expect((await phraseInsights([{ id: 'a', rule: rule('dead_stock') }], null, 'ws')).size).toBe(
      0,
    );
  });
});
