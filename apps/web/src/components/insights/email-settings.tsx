'use client';

import { useState, useTransition } from 'react';

import { saveEmailPrefs } from '@/app/w/[slug]/insights/actions';

type Prefs = { weeklySummary: boolean; urgentAlerts: boolean };

const ROWS: { key: keyof Prefs; label: string; description: string }[] = [
  {
    key: 'weeklySummary',
    label: 'Weekly summary',
    description: 'Last week’s sales and orders, and what’s worth a look. Once a week.',
  },
  {
    key: 'urgentAlerts',
    label: 'Urgent alerts',
    description: 'When something needs you soon, like a best seller about to run out.',
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
  const [prefs, setPrefs] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const change = (key: keyof Prefs, on: boolean) => {
    const before = prefs;
    setPrefs({ ...prefs, [key]: on });
    setMessage(null);
    start(async () => {
      const r = await saveEmailPrefs(slug, { [key]: on });
      if (r.ok) setMessage({ ok: true, text: 'Saved.' });
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
          Emails to you
        </h2>
        <p className="text-sm text-muted-foreground">
          {verified
            ? `We send these to ${email}. Only you see this choice.`
            : `Confirm your email address (${email}) to get these. Check your inbox for our link.`}
        </p>
      </div>
      <ul className="grid gap-3">
        {ROWS.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-3">
            <div className="grid gap-0.5">
              <p className="font-medium">{r.label}</p>
              <p className="text-sm text-muted-foreground">{r.description}</p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={prefs[r.key]}
                disabled={pending}
                onChange={(e) => change(r.key, e.target.checked)}
                aria-label={`${r.label} emails: ${prefs[r.key] ? 'on' : 'off'}`}
              />
              {prefs[r.key] ? 'On' : 'Off'}
            </label>
          </li>
        ))}
      </ul>
      {message && (
        <p
          role="status"
          className={message.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
