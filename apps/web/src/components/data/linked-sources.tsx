'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { msg } from '@bizr/i18n/translate';
import { useState, useTransition } from 'react';

import {
  syncNowAction,
  unlinkSourceAction,
  updateSourceAction,
} from '@/app/w/[slug]/data/sources/actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { useCanChange } from '@/components/shell/can-change';

export interface LinkedSource {
  id: string;
  kind: 'google_sheet' | 'shopify' | 'quickbooks' | 'xero' | 'square' | 'woocommerce';
  name: string;
  status: 'active' | 'paused' | 'needs_attention' | 'disconnected';
  autoUpdate: boolean;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
  waitingRunId: string | null;
  link: string | null;
}

const KIND = {
  google_sheet: msg('Google Sheet'),
  shopify: msg('Shopify store'),
  quickbooks: 'QuickBooks',
  xero: 'Xero',
  square: 'Square',
  woocommerce: msg('WooCommerce store'),
};
const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function Source({ slug, source }: { slug: string; source: LinkedSource }) {
  const t = useT();
  const editor = useCanChange();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMessage(
        r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? t('Please try again.') },
      );
    });
  const paused = source.status === 'paused';
  return (
    <li className="grid gap-3 rounded-xl border bg-card p-4" data-testid="linked-source">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(KIND[source.kind])}
          </p>
          <h3 className="font-semibold">{source.name}</h3>
        </div>
        {source.link && (
          <a
            href={source.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('Open')} <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">
              {t('{name} (opens in a new tab)', { name: source.name })}
            </span>
          </a>
        )}
      </div>
      <div className="grid gap-1 text-sm">
        {source.waitingRunId ? (
          <p>
            {t('Has changes for you to check.')}{' '}
            <Link
              href={`/w/${slug}/data/import/${source.waitingRunId}` as Route}
              className="font-medium text-primary underline underline-offset-4"
            >
              {t('Check the changes')}
            </Link>
          </p>
        ) : source.status === 'needs_attention' && source.lastError ? (
          <p className="text-destructive">{t.text(source.lastError)}</p>
        ) : paused ? (
          <p className="text-muted-foreground">
            {t('Paused. We won’t check it until you resume.')}
          </p>
        ) : (
          <p className="text-muted-foreground">
            {source.lastCheckedAt
              ? t('Checked {when}.', { when: when.format(new Date(source.lastCheckedAt)) })
              : t('Not checked yet.')}{' '}
            {source.lastChangedAt
              ? t('Last change brought in {when}.', {
                  when: when.format(new Date(source.lastChangedAt)),
                })
              : ''}
          </p>
        )}
      </div>
      {editor && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={source.autoUpdate}
              disabled={pending}
              onChange={(e) =>
                act(
                  () => updateSourceAction(slug, source.id, { autoUpdate: e.target.checked }),
                  e.target.checked
                    ? t('Changes will come in by themselves when nothing needs you.')
                    : t('We’ll ask you before bringing in changes.'),
                )
              }
            />
            {t('Bring in changes by itself when nothing needs me')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || paused}
              onClick={() =>
                act(() => syncNowAction(slug, source.id), t('Checking now. This takes a minute.'))
              }
            >
              <RefreshCw /> {t('Update now')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                act(
                  () => updateSourceAction(slug, source.id, { paused: !paused }),
                  paused ? t('Resumed.') : t('Paused.'),
                )
              }
            >
              {paused ? t('Resume') : t('Pause')}
            </Button>
            {confirming ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                {t('Stop updating from this? Your records stay.')}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => act(() => unlinkSourceAction(slug, source.id), t('Stopped.'))}
                >
                  {t('Stop updating')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {t('Keep it')}
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                {t('Stop updating from this')}
              </Button>
            )}
          </div>
        </>
      )}
      {message && (
        <p
          role="status"
          // i18n-skip (styles, not text)
          className={message.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
        >
          {message.text}
        </p>
      )}
    </li>
  );
}

/** My data → "Kept up to date from": each linked source, its state, and what you can do. */
export function LinkedSources({ slug, sources }: { slug: string; sources: LinkedSource[] }) {
  const t = useT();
  if (sources.length === 0) return null;
  return (
    <section className="grid gap-3" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="font-medium">
        {t('Kept up to date from')}
      </h2>
      <ul className="grid gap-3 lg:grid-cols-2">
        {sources.map((s) => (
          <Source key={s.id} slug={slug} source={s} />
        ))}
      </ul>
    </section>
  );
}
