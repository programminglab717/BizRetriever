'use client';

import type { RecordWritePlan, WriteCard } from '@bizr/core/records';
import type { ChangeImpact } from '@bizr/core/structure';
import { AlertTriangle, ArrowRight, Lightbulb, Loader2, Plus, Sparkles } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  addRecords,
  makeChange,
  planDataRequest,
  undoRecords,
  type ChatPlan,
} from '@/app/w/[slug]/data/chat/actions';
import { checkUndo, undoChange } from '@/app/w/[slug]/history/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Toast {
  text: string;
  undo?: () => Promise<void>;
  link?: { href: string; label: string };
}

/**
 * "Change or add by chat" (PRODUCT_SPEC §4.3 and Journey 6): one box for adding or changing records
 * and for changing what's tracked. Every card is rendered from a plan checked by code, and nothing
 * happens until the owner confirms.
 */
export function DataChat({ slug, initial = '' }: { slug: string; initial?: string }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [asked, setAsked] = useState('');
  const [plan, setPlan] = useState<ChatPlan | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = (request: string, picks: Record<string, string> = {}) =>
    startTransition(async () => {
      setError(null);
      setToast(null);
      const r = await planDataRequest(slug, {
        text: request,
        ...(Object.keys(picks).length ? { choices: picks } : {}),
      });
      if (!r.ok) return setError(r.error);
      setAsked(request);
      setChoices(picks);
      setPlan(r.data);
    });
  const reset = () => {
    setPlan(null);
    setText('');
  };

  return (
    <section className="grid gap-3" aria-labelledby="data-chat-heading">
      <h2 id="data-chat-heading" className="font-medium">
        {t('Add or change something')}
      </h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) ask(text.trim());
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={400}
          placeholder={t(
            'e.g. “Add a sale: 5 Sage mugs to Bloom & Co today” or “Track which salesperson made each sale”',
          )}
          aria-label={t('What would you like to add or change?')}
          className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !text.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} {t('Go')}
        </Button>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {plan?.kind === 'record' ? (
        <RecordOutcome
          slug={slug}
          plan={plan}
          pending={pending}
          onPick={(mention, id) => ask(asked, { ...choices, [mention]: id })}
          onCancel={reset}
          onDone={(next) => {
            reset();
            setToast(next);
            router.refresh();
          }}
          onError={setError}
        />
      ) : null}
      {plan?.kind === 'change' ? (
        <ChangeOutcome
          slug={slug}
          plan={plan}
          onCancel={reset}
          onDone={(next) => {
            reset();
            setToast(next);
            router.refresh();
          }}
          onError={setError}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg md:right-6 md:bottom-6 md:left-auto"
        >
          <span className="flex-1">{toast.text}</span>
          {toast.link ? (
            <Link href={toast.link.href as Route} className="font-medium underline">
              {toast.link.label}
            </Link>
          ) : null}
          {toast.undo ? (
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                const u = toast.undo!;
                setToast(null);
                void u().then(() => router.refresh());
              }}
            >
              {t('Undo')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RecordOutcome({
  slug,
  plan,
  pending,
  onPick,
  onCancel,
  onDone,
  onError,
}: {
  slug: string;
  plan: Extract<ChatPlan, { kind: 'record' }>;
  pending: boolean;
  onPick: (mention: string, id: string) => void;
  onCancel: () => void;
  onDone: (t: Toast) => void;
  onError: (e: string) => void;
}) {
  const t = useT();
  const [busy, startTransition] = useTransition();
  const o = plan.outcome;
  if (o.kind === 'none') return <Alert>{t.text(o.message)}</Alert>;
  if (o.kind === 'clarify')
    return (
      <div className="grid gap-2 rounded-xl border p-4 text-sm" data-testid="chat-clarify">
        <p className="font-medium">{t.text(o.question)}</p>
        <div className="flex flex-wrap gap-2">
          {o.options.map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onPick(o.mention, opt.id)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    );
  const apply = (p: RecordWritePlan) =>
    startTransition(async () => {
      const r = await addRecords(slug, p);
      if (!r.ok) return onError(r.error);
      const first = r.data.records[0];
      onDone({
        text:
          p.operation === 'insert'
            ? t('Added {what}.', {
                // The English reads "Added the new sale."; other languages show the card's title.
                what:
                  t.lang === 'en'
                    ? o.card.title.replace(/^New /, 'the new ')
                    : t.text(o.card.title),
              })
            : t('Saved.'),
        undo: async () => {
          const u = await undoRecords(slug, r.data.batchId);
          if (!u.ok) onError(u.error);
        },
        ...(first
          ? { link: { href: `/w/${slug}/data/${first.entity}?open=${first.id}`, label: t('Open') } }
          : {}),
      });
    });
  return (
    <RecordCard card={o.card} busy={busy} onConfirm={() => apply(o.plan)} onCancel={onCancel} />
  );
}

function RecordCard({
  card,
  busy,
  onConfirm,
  onCancel,
}: {
  card: WriteCard;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-3 rounded-xl border p-4 text-sm" data-testid="record-card">
      <p className="text-base font-semibold">{t.text(card.title)}</p>
      <dl className="grid gap-1.5">
        {card.rows.map((r) => (
          <div key={`${r.label}-${r.value}`} className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{t.text(r.label)}</dt>
            <dd className="font-medium">
              {r.before !== undefined ? (
                <>
                  <span className="text-muted-foreground line-through">{r.before}</span>{' '}
                  <ArrowRight className="inline size-3.5" aria-label={t('becomes')} />{' '}
                </>
              ) : null}
              {r.value}
              {r.isNew ? (
                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {t('new')}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {card.items.length ? (
        <ul className="grid gap-1 border-t pt-2">
          {card.items.map((i) => (
            <li key={i.text} className="flex justify-between gap-3">
              <span>{i.text}</span>
              {i.total ? <span className="tabular-nums">{i.total}</span> : null}
            </li>
          ))}
          {card.total ? (
            <li className="flex justify-between gap-3 border-t pt-1 font-semibold">
              <span>{t('Total')}</span>
              <span className="tabular-nums">{card.total}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {card.creates.map((c) => (
        <p key={c} className="flex gap-2 text-primary">
          <Plus className="mt-0.5 size-4 shrink-0" aria-hidden />{' '}
          {t('{what} will be added too.', { what: t.text(c) })}
        </p>
      ))}
      {card.assumptions.length ? (
        <div className="grid gap-1 rounded-lg bg-muted/50 p-3">
          <p className="flex items-center gap-2 font-medium">
            <Lightbulb className="size-4" aria-hidden /> {t('What I assumed')}
          </p>
          <ul className="grid list-disc gap-0.5 pl-5 text-muted-foreground">
            {card.assumptions.map((a) => (
              <li key={a}>{t.text(a)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onConfirm}>
          {busy ? <Loader2 className="animate-spin" /> : null} {t.text(card.action)}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </div>
  );
}

function ChangeOutcome({
  slug,
  plan,
  onCancel,
  onDone,
  onError,
}: {
  slug: string;
  plan: Extract<ChatPlan, { kind: 'change' }>;
  onCancel: () => void;
  onDone: (t: Toast) => void;
  onError: (e: string) => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [busy, startTransition] = useTransition();
  const o = plan.outcome;
  if (o.kind === 'none') return <Alert>{t.text(o.message)}</Alert>;
  if (o.kind === 'clarify') return <Alert>{t.text(o.question)}</Alert>;
  const impact: ChangeImpact = o.impact;
  const ready =
    !impact.destructive || typed.trim().toLowerCase() === (impact.confirmText ?? '').toLowerCase();
  const apply = () =>
    startTransition(async () => {
      const r = await makeChange(slug, o.plan, typed);
      if (!r.ok) return onError(r.error);
      const version = r.data.version;
      onDone({
        text: t('Done. It’s in your change history.'),
        link: { href: `/w/${slug}/history`, label: t('History') },
        undo: async () => {
          const check = await checkUndo(slug, version);
          if (!check.ok) return onError(check.error);
          // Losing data since needs the full explanation: send them to the history page.
          if (check.data.needsConfirmation)
            return onError(
              t(
                'Undoing this would lose data entered since. Use Change history to see what and undo.',
              ),
            );
          const u = await undoChange(slug, version, false);
          if (!u.ok) onError(u.error);
        },
      });
    });
  return (
    <div
      className={cn(
        'grid gap-3 rounded-xl border p-4 text-sm',
        impact.destructive && 'border-destructive/50',
      )}
      data-testid="change-card"
    >
      <p className="text-base font-semibold">{t('What will change')}</p>
      <ul className="grid gap-2">
        {impact.steps.map((s) => (
          <li key={s.text} className="grid gap-0.5">
            <span className="font-medium">{t.text(s.text)}</span>
            {s.details.map((d) => (
              <span
                key={d}
                className={cn('text-muted-foreground', s.destructive && 'text-destructive')}
              >
                {t.text(d)}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {o.explanation ? <p className="text-muted-foreground">{t.text(o.explanation)}</p> : null}
      <p data-testid="change-impact">{t.text(impact.summary)}</p>
      {impact.destructive ? (
        <div className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" aria-hidden />{' '}
            {t('This removes data. We keep a backup for 30 days so you can undo.')}
          </p>
          <label className="grid gap-1">
            <span>
              {/* The words to type stay as they are; only the sentence around them is translated. */}
              {t('Type {text} to confirm')
                .split('{text}')
                .map((part, i) => (
                  <span key={i}>
                    {i > 0 ? <strong>{impact.confirmText}</strong> : null}
                    {part}
                  </span>
                ))}
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label={t('Type {text} to confirm', { text: impact.confirmText ?? '' })}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            />
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          // i18n-skip (a style, not text)
          variant={impact.destructive ? 'destructive' : 'default'}
          disabled={busy || !ready}
          onClick={apply}
        >
          {busy ? <Loader2 className="animate-spin" /> : null} {t('Make this change')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </Button>
      </div>
    </div>
  );
}
