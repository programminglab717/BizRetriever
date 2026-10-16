'use client';

import type { AlertSetting } from '@bizr/core/insights';
import { useState, useTransition } from 'react';

import { saveAlert } from '@/app/w/[slug]/insights/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORY: Record<string, string> = {
  stock: 'Stock',
  customers: 'Customers',
  profit: 'Profit',
  products: 'Products',
  trends: 'Trends',
  cash: 'Money owed',
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
  const [enabled, setEnabled] = useState(setting.enabled);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(setting.thresholds.map((t) => [t.name, String(t.value)])),
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const thresholds: Record<string, number> = {};
      for (const t of setting.thresholds) {
        const v = Number(values[t.name]);
        if (!Number.isFinite(v) || values[t.name]?.trim() === '') {
          setMessage({ ok: false, text: 'Please enter a number.' });
          return;
        }
        thresholds[t.name] = v;
      }
      const r = await saveAlert(slug, { ruleId: setting.ruleId, enabled, thresholds });
      setMessage(
        r.ok
          ? { ok: true, text: 'Saved. We’re checking your data again with these settings.' }
          : { ok: false, text: r.error },
      );
    });
  return (
    <li id={setting.ruleId} className="grid scroll-mt-20 gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {CATEGORY[setting.category] ?? setting.category}
          </p>
          <h2 className="font-semibold">{setting.label}</h2>
          <p className="text-sm text-muted-foreground">{setting.description}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label={`${setting.label}: ${enabled ? 'on' : 'off'}`}
          />
          {enabled ? 'On' : 'Off'}
        </label>
      </div>
      {setting.thresholds.map((t) => (
        <label key={t.name} className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t.before}</span>
          {t.unit === 'money' && <span className="text-muted-foreground">{currency}</span>}
          <Input
            type="number"
            inputMode="decimal"
            min={t.min}
            max={t.max}
            step="any"
            className="h-9 w-24"
            value={values[t.name] ?? ''}
            disabled={!enabled}
            aria-label={`${t.before} … ${t.after}`.trim()}
            onChange={(e) => setValues((v) => ({ ...v, [t.name]: e.target.value }))}
          />
          {t.after && <span>{t.after}</span>}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {message && (
          <p
            role="status"
            className={message.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
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
