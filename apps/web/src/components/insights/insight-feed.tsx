'use client';

import type { InsightCard as Card } from '@bizr/core/insights';
import type { NoteView } from '@bizr/core/team';
import { msg } from '@bizr/i18n/translate';
import {
  BadgePercent,
  MoreVertical,
  Package,
  Tag,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { dismiss, markSeen } from '@/app/w/[slug]/insights/actions';
import { assignAction, doneAction } from '@/app/w/[slug]/team-actions';
import { useT } from '@/components/i18n/provider';
import { Notes } from '@/components/team/notes';
import { useTeam } from '@/components/team/team-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCanChange } from '@/components/shell/can-change';

/** Plain JSON for the client: dates as strings. */
export type InsightCardData = Omit<Card, 'firstSeenAt' | 'lastSeenAt'>;

const ICONS: Record<string, LucideIcon> = {
  stock: Package,
  customers: Users,
  profit: BadgePercent,
  products: Tag,
  trends: TrendingUp,
  cash: Wallet,
};

const LEVEL: Record<string, { label: string; className: string }> = {
  urgent: { label: msg('Urgent'), className: 'bg-red-100 text-red-800' },
  warn: { label: msg('Worth a look'), className: 'bg-amber-100 text-amber-900' },
  info: { label: msg('Good to know'), className: 'bg-muted text-muted-foreground' },
};

function actionHref(slug: string, a: NonNullable<InsightCardData['action']>): string {
  if (a.kind === 'ask') return `/w/${slug}/ask?q=${encodeURIComponent(a.question)}`;
  return `/w/${slug}/data/${a.entity}${a.search ? `?q=${encodeURIComponent(a.search)}` : ''}`;
}

/**
 * An insight's sentence, with its values in bold. In another language the whole sentence is
 * translated when the catalog has it (the bold is lost then: it can't be placed in a translation).
 */
function Segments({ segments }: { segments: { text: string; bold?: true }[] }) {
  const t = useT();
  const english = segments.map((s) => s.text).join('');
  const translated = t.text(english);
  if (translated !== english) return <>{translated}</>;
  return (
    <>
      {segments.map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-semibold">
            {s.text}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function InsightItem({
  slug,
  insight,
  notes,
  onGone,
}: {
  slug: string;
  insight: InsightCardData;
  notes: NoteView[] | undefined;
  onGone: (id: string) => void;
}) {
  const t = useT();
  const editor = useCanChange();
  const { me, people } = useTeam();
  const router = useRouter();
  const mine = Boolean(insight.assignedTo) && insight.assignedTo === me;
  const holderName = people.find((p) => p.id === insight.assignedTo)?.name;
  const forWhom = !insight.assignedTo
    ? null
    : mine
      ? t('For you')
      : holderName
        ? t('For {name}', { name: holderName })
        : t('For someone');
  const team = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setMenu(false);
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const Icon = ICONS[insight.category] ?? TrendingUp;
  const level = LEVEL[insight.level] ?? LEVEL.info!;
  const hide = (notUseful: boolean) =>
    start(async () => {
      const r = await dismiss(slug, insight.id, notUseful);
      if (r.ok) onGone(insight.id);
      else setError(r.error);
    });
  return (
    <li
      className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-xl border bg-card p-4"
      aria-label={t.text(insight.text)}
    >
      <span
        className={cn('mt-0.5 grid size-9 place-items-center rounded-full', level.className)}
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full px-2 py-0.5 font-medium', level.className)}>
            {t(level.label)}
          </span>
          {insight.status === 'new' && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {t('New')}
            </span>
          )}
          {forWhom && (
            <span
              className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-900"
              data-testid="assigned"
            >
              {forWhom}
            </span>
          )}
        </div>
        <p className="leading-snug">
          <Segments segments={insight.headline} />
        </p>
        {insight.context && (
          <p className="text-sm text-muted-foreground">
            <Segments segments={insight.context} />
          </p>
        )}
        {(insight.action || mine) && (
          <div className="flex flex-wrap gap-2">
            {insight.action && (
              <Button asChild size="sm" variant="outline">
                <Link href={actionHref(slug, insight.action) as Route}>
                  {t.text(insight.action.label)}
                </Link>
              </Button>
            )}
            {mine && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => team(() => doneAction(slug, insight.id))}
              >
                {t('Mark done')}
              </Button>
            )}
          </div>
        )}
        <Notes slug={slug} subject={{ kind: 'insight', id: insight.id }} initial={notes} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('More options')}
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
          disabled={pending}
        >
          <MoreVertical className="size-4" />
        </Button>
        {menu && (
          <div
            role="menu"
            className="absolute right-0 z-10 mt-1 grid w-48 rounded-md border bg-popover p-1 text-sm shadow-md"
          >
            {editor &&
              people
                .filter((p) => p.id !== insight.assignedTo)
                .map((p) => (
                  <button
                    key={p.id}
                    role="menuitem"
                    className="rounded px-3 py-2 text-left hover:bg-accent"
                    onClick={() => team(() => assignAction(slug, insight.id, p.id))}
                  >
                    {p.id === me ? t('I’ll deal with it') : t('Hand to {name}', { name: p.name })}
                  </button>
                ))}
            {editor && insight.assignedTo && (
              <button
                role="menuitem"
                className="rounded px-3 py-2 text-left hover:bg-accent"
                onClick={() => team(() => assignAction(slug, insight.id, null))}
              >
                {t('Take it back')}
              </button>
            )}
            {editor && (
              <>
                <button
                  role="menuitem"
                  className="rounded px-3 py-2 text-left hover:bg-accent"
                  onClick={() => hide(false)}
                >
                  {t('Dismiss')}
                </button>
                <button
                  role="menuitem"
                  className="rounded px-3 py-2 text-left hover:bg-accent"
                  onClick={() => hide(true)}
                >
                  {t('Not useful')}
                </button>
              </>
            )}
            <Link
              role="menuitem"
              href={`/w/${slug}/insights/settings#${insight.ruleId}` as Route}
              className="rounded px-3 py-2 hover:bg-accent"
            >
              {t('Change alert settings')}
            </Link>
          </div>
        )}
      </div>
    </li>
  );
}

/** The insight cards, most important first. Showing them marks them as seen. */
export function InsightFeed({
  slug,
  insights,
  notes = {},
  empty,
  label,
}: {
  slug: string;
  insights: InsightCardData[];
  notes?: Record<string, NoteView[]>;
  /** Shown instead of the usual "nothing needs your attention". */
  empty?: string;
  label?: string;
}) {
  const t = useT();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    const fresh = insights.filter((i) => i.status === 'new').map((i) => i.id);
    if (fresh.length) void markSeen(slug, fresh);
  }, [slug, insights]);
  const shown = insights.filter((i) => !gone.has(i.id));
  if (shown.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
        {empty ??
          t('Nothing needs your attention right now. 🎉 We check every time your data changes.')}
      </p>
    );
  return (
    <ul className="grid gap-3" aria-label={label ?? t('Insights')}>
      {shown.map((i) => (
        <InsightItem
          key={i.id}
          slug={slug}
          insight={i}
          notes={notes[i.id] ?? []}
          onGone={(id) => setGone((g) => new Set(g).add(id))}
        />
      ))}
    </ul>
  );
}
