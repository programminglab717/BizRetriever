'use client';

import type { AlertSetting } from '@bizr/core/insights';
import { msg } from '@bizr/i18n/translate';
import { useState, useTransition } from 'react';

import { saveAlert } from '@/app/w/[slug]/insights/actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const CATEGORY: Record<string, string> = {
  stock: msg('Stock'),
  customers: msg('Customers'),
  profit: msg('Profit'),
  products: msg('Products'),
  trends: msg('Trends'),
  cash: msg('Money owed'),
};

function AlertRow({
  slug,
  setting,
  currency,
}: {
  slug: string;
  setting: AlertSetting;
  currency: string;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(setting.enabled);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(setting.thresholds.map((th) => [th.name, String(th.value)])),
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const thresholds: Record<string, number> = {};
      for (const th of setting.thresholds) {
        const v = Number(values[th.name]);
        if (!Number.isFinite(v) || values[th.name]?.trim() === '') {
          setMessage({ ok: false, text: t('Please enter a number.') });
          return;
        }
        thresholds[th.name] = v;
      }
      const r = await saveAlert(slug, { ruleId: setting.ruleId, enabled, thresholds });
      setMessage(
        r.ok
          ? { ok: true, text: t('Saved. We’re checking your data again with these settings.') }
          : { ok: false, text: r.error },
      );
    });
  return (
    <li id={setting.ruleId} className="grid scroll-mt-20 gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t.text(CATEGORY[setting.category] ?? setting.category)}
          </p>
          <h2 className="font-semibold">{t.text(setting.label)}</h2>
          <p className="text-sm text-muted-foreground">{t.text(setting.description)}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label={
              enabled
                ? t('{label}: on', { label: t.text(setting.label) })
                : t('{label}: off', { label: t.text(setting.label) })
            }
          />
          {enabled ? t('On') : t('Off')}
        </label>
      </div>
      {setting.thresholds.map((th) => (
        <label key={th.name} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t.text(th.before)}</span>
          {th.unit === 'money' && <span className="text-muted-foreground">{currency}</span>}
          <Input
            type="number"
            inputMode="decimal"
            min={th.min}
            max={th.max}
            step="any"
            className="h-9 w-24"
            value={values[th.name] ?? ''}
            disabled={!enabled}
            aria-label={`${t.text(th.before)} … ${t.text(th.after)}`.trim()}
            onChange={(e) => setValues((v) => ({ ...v, [th.name]: e.target.value }))}
          />
          {th.after && <span>{t.text(th.after)}</span>}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? t('Saving…') : t('Save')}
        </Button>
        {message && (
          <p
            role="status"
            className={cn('text-sm', message.ok ? 'text-muted-foreground' : 'text-destructive')}
          >
            {message.text}
          </p>
        )}
      </div>
    </li>
  );
}

export function AlertSettings({
  slug,
  settings,
  currency,
}: {
  slug: string;
  settings: AlertSetting[];
  currency: string;
}) {
  return (
    <ul className="grid gap-3">
      {settings.map((s) => (
        <AlertRow key={s.ruleId} slug={slug} setting={s} currency={currency} />
      ))}
    </ul>
  );
}
