'use client';

import type { PlanOutcome } from '@bizr/core/dashboard';
import { Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';

import { editAction, planAction } from '@/app/w/[slug]/dashboard/actions';
import type { NumberStyle } from '@/components/ask/answer-chart';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import { DashboardTile } from './dashboard-tile';

/** "Change this dashboard": the owner's words → a preview → Apply or Cancel. */
export function EditBox({
  slug,
  style,
  disabled,
  onApplied,
}: {
  slug: string;
  style: NumberStyle;
  disabled: boolean;
  onApplied: (changes: string[]) => void;
}) {
  const t = useT();
  const [request, setRequest] = useState('');
  const [outcome, setOutcome] = useState<PlanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const plan = (text: string, tileId?: string) =>
    start(async () => {
      setError(null);
      setOutcome(await planAction(slug, text, tileId));
    });
  const apply = () =>
    start(async () => {
      if (outcome?.kind !== 'plan') return;
      const r = await editAction(slug, outcome.ops);
      if (!r.ok) return setError(r.error);
      setOutcome(null);
      setRequest('');
      onApplied(r.changes);
    });

  return (
    <section className="grid gap-3" aria-label={t('Dashboard changes')}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (request.trim()) plan(request);
        }}
      >
        <label htmlFor="dashboard-edit" className="sr-only">
          {t('Change this dashboard')}
        </label>
        <Input
          id="dashboard-edit"
          value={request}
          maxLength={300}
          placeholder={t('Change this dashboard, e.g. “Add a chart of sales by city”')}
          onChange={(e) => setRequest(e.target.value)}
          disabled={disabled || pending}
        />
        <Button type="submit" variant="outline" disabled={disabled || pending || !request.trim()}>
          <Sparkles /> {pending ? t('Working…') : t.ctx('button', 'Change')}
        </Button>
      </form>

      {error && <Alert tone="error">{error}</Alert>}

      {outcome?.kind === 'none' && <Alert>{t.text(outcome.message)}</Alert>}

      {outcome?.kind === 'clarify' && (
        <Card data-testid="edit-clarify">
          <CardContent className="grid gap-3 pt-6">
            <p>{t.text(outcome.question)}</p>
            <div className="flex flex-wrap gap-2">
              {outcome.options.map((o) => (
                <Button key={o.tileId} variant="outline" onClick={() => plan(request, o.tileId)}>
                  {t.text(o.label)}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setOutcome(null)}>
                {t('Cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {outcome?.kind === 'plan' && (
        <Card data-testid="edit-preview">
          <CardContent className="grid gap-4 pt-6">
            <div>
              <p className="font-medium">{t('Here’s the change:')}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {outcome.changes.map((c) => (
                  <li key={c}>{t.text(c)}</li>
                ))}
              </ul>
            </div>
            {outcome.preview.length > 0 && (
              <div className="grid gap-4 md:grid-cols-12">
                {outcome.preview.map((tile) => (
                  <DashboardTile
                    key={tile.id}
                    slug={slug}
                    tile={tile}
                    style={style}
                    first
                    last
                    busy
                    onEdit={() => {}}
                  />
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={apply} disabled={pending}>
                {t('Apply')}
              </Button>
              <Button variant="ghost" onClick={() => setOutcome(null)} disabled={pending}>
                {t('Cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
