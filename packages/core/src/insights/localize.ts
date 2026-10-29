import type { Language } from '@bizr/i18n';
import { getPack, type PackInsightRule } from '@bizr/packs';

import { localeFor } from '../ask/view';
import type { MemberWorkspace } from '../workspaces/service';
import type { FactValue } from './evaluate';
import type { InsightCard } from './feed';
import { insightText, renderInsight, type RenderOptions } from './render';

/**
 * Insights in the reader's language (M20, ADR-071). An insight is stored as English sentences plus
 * the facts they were filled from; for a Spanish reader the pack's Spanish sentence is filled from
 * the same facts by the same code, so every number is still the one the rule found. A sentence an
 * AI rephrased (Task J) is English only, so Spanish readers get the pack's own wording.
 */

/** The text facts, in this language: fallbacks ("your supplier") and chosen words ("up"). */
function localFacts(
  rule: PackInsightRule,
  tr: NonNullable<ReturnType<typeof getPack>['translations']['es']>['insights'][string],
  facts: Record<string, FactValue>,
): Record<string, FactValue> {
  const out: Record<string, FactValue> = { ...facts };
  for (const [name, f] of Object.entries(facts)) {
    if (f.format !== 'text') continue;
    const def = rule.facts[name];
    const fallback = def && 'fallback' in def ? def.fallback : undefined;
    if (fallback && f.value === fallback && tr.fallbacks[name])
      out[name] = { ...f, value: tr.fallbacks[name] };
    const word = tr.words[name]?.[f.value];
    if (word) out[name] = { ...f, value: word };
  }
  return out;
}

export function localizeInsights<C extends InsightCard & { facts: unknown }>(
  member: MemberWorkspace,
  cards: C[],
  lang: Language,
): C[] {
  if (lang === 'en') return cards;
  const pack = getPack(member.workspace.packId);
  const translation = pack.translations[lang];
  if (!translation) return cards;
  const o: RenderOptions = {
    locale: localeFor(member.settings, lang),
    currency: member.settings.currency,
    lang,
  };
  return cards.map((card) => {
    const rule = pack.insights.rules.find((r) => r.id === card.ruleId);
    const tr = translation.insights[card.ruleId];
    if (!rule || !tr || !card.facts || typeof card.facts !== 'object') return card;
    try {
      const facts = localFacts(rule, tr, card.facts as Record<string, FactValue>);
      const headline = renderInsight(tr.template, facts, o);
      const action = card.action
        ? card.action.kind === 'ask' && tr.action?.ask
          ? {
              ...card.action,
              label: tr.action.label,
              question: insightText(renderInsight(tr.action.ask.replaceAll('**', ''), facts, o)),
            }
          : { ...card.action, label: tr.action?.label ?? card.action.label }
        : card.action;
      return {
        ...card,
        headline,
        context: tr.context ? renderInsight(tr.context, facts, o) : card.context,
        text: insightText(headline),
        action,
      };
    } catch {
      // Facts stored by an older version of the rule: keep the English sentence.
      return card;
    }
  });
}
