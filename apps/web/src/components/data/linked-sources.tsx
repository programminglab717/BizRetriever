'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import {
  syncNowAction,
  unlinkSourceAction,
  updateSourceAction,
} from '@/app/w/[slug]/data/sources/actions';
import { Button } from '@/components/ui/button';
import { useCanChange } from '@/components/shell/can-change';

export interface LinkedSource {
  id: string;
  kind: 'google_sheet' | 'shopify';
  name: string;
  status: 'active' | 'paused' | 'needs_attention' | 'disconnected';
  autoUpdate: boolean;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
  waitingRunId: string | null;
  link: string | null;
}

const KIND = { google_sheet: 'Google Sheet', shopify: 'Shopify store' } as const;
const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function Source({ slug, source }: { slug: string; source: LinkedSource }) {
  const editor = useCanChange();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMessage(
        r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? 'Please try again.' },
      );
    });
  const paused = source.status === 'paused';
  return (
    <li className="grid gap-3 rounded-xl border bg-card p-4" data-testid="linked-source">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {KIND[source.kind]}
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
            Open <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">{source.name} (opens in a new tab)</span>
          </a>
        )}
      </div>
      <div className="grid gap-1 text-sm">
        {source.waitingRunId ? (
          <p>
            Has changes for you to check.{' '}
            <Link
              href={`/w/${slug}/data/import/${source.waitingRunId}` as Route}
              className="font-medium text-primary underline underline-offset-4"
            >
              Check the changes
            </Link>
          </p>
        ) : source.status === 'needs_attention' && source.lastError ? (
          <p className="text-destructive">{source.lastError}</p>
        ) : paused ? (
          <p className="text-muted-foreground">Paused. We won’t check it until you resume.</p>
        ) : (
          <p className="text-muted-foreground">
            {source.lastCheckedAt
              ? `Checked ${when.format(new Date(source.lastCheckedAt))}.`
              : 'Not checked yet.'}{' '}
            {source.lastChangedAt
              ? `Last change brought in ${when.format(new Date(source.lastChangedAt))}.`
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
                    ? 'Changes will come in by themselves when nothing needs you.'
                    : 'We’ll ask you before bringing in changes.',
                )
              }
            />
            Bring in changes by itself when nothing needs me
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || paused}
              onClick={() =>
                act(() => syncNowAction(slug, source.id), 'Checking now. This takes a minute.')
              }
            >
              <RefreshCw /> Update now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                act(
                  () => updateSourceAction(slug, source.id, { paused: !paused }),
                  paused ? 'Resumed.' : 'Paused.',
                )
              }
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            {confirming ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                Stop updating from this? Your records stay.
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => act(() => unlinkSourceAction(slug, source.id), 'Stopped.')}
                >
                  Stop updating
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                Stop updating from this
              </Button>
            )}
          </div>
        </>
      )}
      {message && (
        <p
          role="status"
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
  if (sources.length === 0) return null;
  return (
    <section className="grid gap-3" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="font-medium">
        Kept up to date from
      </h2>
      <ul className="grid gap-3 lg:grid-cols-2">
        {sources.map((s) => (
          <Source key={s.id} slug={slug} source={s} />
        ))}
      </ul>
    </section>
  );
}
