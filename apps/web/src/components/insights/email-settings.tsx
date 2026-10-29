'use client';

import { msg } from '@bizr/i18n/translate';
import { useState, useTransition } from 'react';

import { saveEmailPrefs } from '@/app/w/[slug]/insights/actions';
import { useT } from '@/components/i18n/provider';
import { cn } from '@/lib/utils';

type Prefs = { weeklySummary: boolean; urgentAlerts: boolean; mentions: boolean };

const ROWS: { key: keyof Prefs; label: string; description: string }[] = [
  {
    key: 'weeklySummary',
    label: msg('Weekly summary'),
    description: msg('Last week’s sales and orders, and what’s worth a look. Once a week.'),
  },
  {
    key: 'urgentAlerts',
    label: msg('Urgent alerts'),
    description: msg('When something needs you soon, like a best seller about to run out.'),
  },
  {
    key: 'mentions',
    label: msg('When someone mentions you'),
    description: msg(
      'When someone in the business writes your name in a note, like “@Sam, can you check?”',
    ),
  },
];

/** The signed-in person's emails from this business. Saved as soon as a box changes. */
export function EmailSettings({
  slug,
  initial,
  email,
  verified,
}: {
  slug: string;
  initial: Prefs;
  email: string;
  verified: boolean;
}) {
  const t = useT();
  const [prefs, setPrefs] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const change = (key: keyof Prefs, on: boolean) => {
    const before = prefs;
    setPrefs({ ...prefs, [key]: on });
    setMessage(null);
    start(async () => {
      const r = await saveEmailPrefs(slug, { [key]: on });
      if (r.ok) setMessage({ ok: true, text: t('Saved.') });
      else {
        setPrefs(before);
        setMessage({ ok: false, text: r.error });
      }
    });
  };
  return (
    <section aria-labelledby="email-heading" className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="grid gap-0.5">
        <h2 id="email-heading" className="font-semibold">
          {t('Emails to you')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {verified
            ? t('We send these to {email}. Only you see this choice.', { email })
            : t(
                'Confirm your email address ({email}) to get these. Check your inbox for our link.',
                {
                  email,
                },
              )}
        </p>
      </div>
      <ul className="grid gap-3">
        {ROWS.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-3">
            <div className="grid gap-0.5">
              <p className="font-medium">{t(r.label)}</p>
              <p className="text-sm text-muted-foreground">{t(r.description)}</p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={prefs[r.key]}
                disabled={pending}
                onChange={(e) => change(r.key, e.target.checked)}
                aria-label={
                  prefs[r.key]
                    ? t('{label} emails: on', { label: t(r.label) })
                    : t('{label} emails: off', { label: t(r.label) })
                }
              />
              {prefs[r.key] ? t('On') : t('Off')}
            </label>
          </li>
        ))}
      </ul>
      {message && (
        <p
          role="status"
          className={cn('text-sm', message.ok ? 'text-muted-foreground' : 'text-destructive')}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
