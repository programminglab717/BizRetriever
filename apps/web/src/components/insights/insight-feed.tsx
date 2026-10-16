'use client';

import type { InsightCard as Card } from '@bizr/core/insights';
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
import { useEffect, useRef, useState, useTransition } from 'react';

import { dismiss, markSeen } from '@/app/w/[slug]/insights/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-800' },
  warn: { label: 'Worth a look', className: 'bg-amber-100 text-amber-900' },
  info: { label: 'Good to know', className: 'bg-muted text-muted-foreground' },
};

function actionHref(slug: string, a: NonNullable<InsightCardData['action']>): string {
  if (a.kind === 'ask') return `/w/${slug}/ask?q=${encodeURIComponent(a.question)}`;
  return `/w/${slug}/data/${a.entity}${a.search ? `?q=${encodeURIComponent(a.search)}` : ''}`;
}

function Segments({ segments }: { segments: { text: string; bold?: true }[] }) {
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
  onGone,
}: {
  slug: string;
  insight: InsightCardData;
  onGone: (id: string) => void;
}) {
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
      aria-label={insight.text}
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
            {level.label}
          </span>
          {insight.status === 'new' && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              New
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
        {insight.action && (
          <div>
            <Button asChild size="sm" variant="outline">
              <Link href={actionHref(slug, insight.action) as Route}>{insight.action.label}</Link>
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          aria-label="More options"
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
            <button
              role="menuitem"
              className="rounded px-3 py-2 text-left hover:bg-accent"
              onClick={() => hide(false)}
            >
              Dismiss
            </button>
            <button
              role="menuitem"
              className="rounded px-3 py-2 text-left hover:bg-accent"
              onClick={() => hide(true)}
            >
              Not useful
            </button>
            <Link
              role="menuitem"
              href={`/w/${slug}/insights/settings#${insight.ruleId}` as Route}
              className="rounded px-3 py-2 hover:bg-accent"
            >
              Change alert settings
            </Link>
          </div>
        )}
      </div>
    </li>
  );
}

/** The insight cards, most important first. Showing them marks them as seen. */
export function InsightFeed({ slug, insights }: { slug: string; insights: InsightCardData[] }) {
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
        Nothing needs your attention right now. 🎉 We check every time your data changes.
      </p>
    );
  return (
    <ul className="grid gap-3" aria-label="Insights">
      {shown.map((i) => (
        <InsightItem
          key={i.id}
          slug={slug}
          insight={i}
          onGone={(id) => setGone((g) => new Set(g).add(id))}
        />
      ))}
    </ul>
  );
}
