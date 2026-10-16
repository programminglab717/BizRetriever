import { adminOverview, isAdmin } from '@bizr/core/admin';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { requireUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Admin · BizRetriever', robots: { index: false } };
export const dynamic = 'force-dynamic';

const usd = (v: string | number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  }).format(v as unknown as number);
const ms = (v: number | null) => (v === null ? '–' : `${v} ms`);
const pct = (part: number, whole: number) =>
  whole ? `${((part / whole) * 100).toFixed(1)}%` : '–';

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-3 text-muted-foreground">
                Nothing yet.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-2 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Internal only (ADMIN_EMAILS). Everyone else gets "not found". */
export default async function AdminPage() {
  const user = await requireUser('/admin');
  if (!isAdmin(user.email)) notFound();
  const o = await adminOverview();
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">
          AI over the last {o.sinceDays} days; queries and jobs over the last 7 days.
        </p>
      </header>

      <Section title="AI spend">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Today (UTC)</p>
            <p className="text-2xl font-semibold">
              {usd(o.spend.todayUsd)}{' '}
              <span className="text-base font-normal">of {usd(o.spend.dailyCapUsd)}</span>
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">This month</p>
            <p className="text-2xl font-semibold">
              {usd(o.spend.monthUsd)}{' '}
              <span className="text-base font-normal">of {usd(o.spend.monthlyCapUsd)}</span>
            </p>
          </div>
        </div>
        <Table
          head={['Business', 'Calls', 'Cost', 'Last call']}
          rows={o.byWorkspace.map((w) => [
            w.workspace,
            w.calls,
            usd(w.costUsd),
            w.lastCall ? new Date(w.lastCall).toISOString().slice(0, 16).replace('T', ' ') : '–',
          ])}
        />
      </Section>

      <Section title="AI tasks">
        <Table
          head={[
            'Task',
            'Calls',
            'Live',
            'Replayed',
            'Failed checks',
            'Errors',
            'Blocked',
            'p50',
            'p95',
          ]}
          rows={o.byTask.map((t) => [
            t.task,
            t.calls,
            t.ok,
            t.replayed,
            `${t.invalid} (${pct(t.invalid, t.calls)})`,
            t.failed,
            t.blocked,
            ms(t.p50Ms),
            ms(t.p95Ms),
          ])}
        />
        <p className="text-sm text-muted-foreground">
          Blocked: over the budget or no API key. Failed checks: output that failed validation.
        </p>
      </Section>

      <Section title="Queries">
        <Table
          head={['Origin', 'Path', 'Runs', 'Errors', 'p50', 'p95', 'Max']}
          rows={o.queries.map((q) => [
            q.origin,
            q.path,
            q.runs,
            `${q.errors} (${pct(q.errors, q.runs)})`,
            ms(q.p50Ms),
            ms(q.p95Ms),
            ms(q.maxMs),
          ])}
        />
      </Section>

      <Section title="Background jobs">
        <Table
          head={['Job', 'Runs', 'Failed']}
          rows={o.jobs.map((j) => [j.job, j.runs, `${j.failed} (${pct(j.failed, j.runs)})`])}
        />
      </Section>

      <Section title="Eval baselines (rules only)">
        <Table
          head={['Suite', 'Results']}
          rows={o.baselines.map((b) => [
            b.suite,
            Object.entries(b.metrics)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · '),
          ])}
        />
      </Section>
    </main>
  );
}
