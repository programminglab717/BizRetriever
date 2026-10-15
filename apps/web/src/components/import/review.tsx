'use client';

import type { ReviewAction } from '@bizr/core/ingestion';
import { Loader2, Sparkles, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  approveImport,
  cancelImport,
  reviewAction,
  type ActionResult,
} from '@/app/w/[slug]/data/import/[runId]/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ImportView } from '@/lib/imports';
import { cn } from '@/lib/utils';

type Proposal = NonNullable<ImportView['proposal']>;
const fmt = new Intl.NumberFormat('en-US');

export function Review({
  slug,
  runId,
  proposal,
  currency,
  updating,
  onAction,
  onApproved,
}: {
  slug: string;
  runId: string;
  proposal: Proposal;
  currency: string;
  updating: boolean;
  onAction: () => void;
  onApproved: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const disabled = updating || pending;

  const perform = (fn: () => Promise<ActionResult>, after: () => void = onAction) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else after();
    });
  const act = (action: ReviewAction) =>
    perform(() => reviewAction(slug, runId, proposal.id, action));

  return (
    <div className="grid gap-6" aria-busy={disabled}>
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Here’s what we found</h1>
        {updating ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Updating with your changes…
          </p>
        ) : null}
      </header>

      <Card className={cn(updating && 'opacity-60')}>
        <CardContent className="grid gap-3 pt-6">
          <p className="text-lg leading-relaxed" data-testid="review-summary">
            {proposal.summary.map((s, i) =>
              s.fact ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>,
            )}
          </p>
          {proposal.aiNote ? (
            <p className="text-sm text-muted-foreground">
              {proposal.aiNote} We used our standard checks instead.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {proposal.changes.length > 0 && proposal.version > 1 ? (
        <Alert tone="success">
          <p className="font-medium">What changed</p>
          <ul className="mt-1 list-disc pl-5">
            {proposal.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {proposal.questions.length > 0 || proposal.warnings.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="quick-look">
          <h2 id="quick-look" className="text-lg font-semibold">
            Needs a quick look
          </h2>
          {proposal.questions.map((q) => (
            <Card key={q.id} data-testid="review-question">
              <CardContent className="grid gap-3 pt-6">
                <p>{q.text}</p>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <Button
                      key={o.id}
                      variant={o.id === q.defaultOption ? 'default' : 'outline'}
                      disabled={disabled}
                      onClick={() => act({ kind: 'answer', questionId: q.id, optionId: o.id })}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  If you skip this, we’ll go with “
                  {q.options.find((o) => o.id === q.defaultOption)?.label}”.
                </p>
              </CardContent>
            </Card>
          ))}
          {proposal.warnings.map((w) => (
            <Alert key={w}>{w}</Alert>
          ))}
        </section>
      ) : null}

      <section className="grid gap-3" aria-labelledby="bring-in">
        <h2 id="bring-in" className="text-lg font-semibold">
          What we’ll bring in
        </h2>
        {proposal.entities.length === 0 ? (
          <Alert>
            We couldn’t match these files to a shop’s usual records yet. Tell us below what they
            hold (for example “these are my sales”).
          </Alert>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {proposal.entities.map((e) => (
            <EntityCard
              key={e.key}
              entity={e}
              fieldOptions={proposal.fieldOptions[e.key] ?? []}
              currency={currency}
              disabled={disabled}
              act={act}
            />
          ))}
        </div>
      </section>

      {proposal.skipped.length > 0 || proposal.ignored.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="skip">
          <h2 id="skip" className="text-lg font-semibold">
            What we’ll skip
          </h2>
          <Card>
            <CardContent className="grid gap-2 pt-6 text-sm">
              {proposal.skipped.map((s) => (
                <details key={s.reason}>
                  <summary className="cursor-pointer">
                    {s.label}: <strong>{fmt.format(s.count)}</strong>
                  </summary>
                  <ul className="mt-2 grid gap-1 pl-4 text-xs text-muted-foreground">
                    {s.examples.map((x) => (
                      <li key={`${x.fileName}-${x.sheet}-${x.row}`}>
                        {x.sheet} line {x.row}: {x.text || '(blank)'}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {proposal.ignored.map((s) => (
                <p key={s.sourceId}>
                  “{s.sheet === s.fileName ? s.fileName : `${s.fileName} › ${s.sheet}`}”: {s.reason}
                </p>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {proposal.assumptions.length > 0 || proposal.corrections.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="assumed">
          <h2 id="assumed" className="text-lg font-semibold">
            Things we assumed
          </h2>
          <Card>
            <CardContent className="grid gap-2 pt-6 text-sm">
              {proposal.assumptions.map((a) => (
                <p key={a.id} className={cn(a.confidence < 0.7 && 'font-medium')}>
                  {a.text}
                  {a.confidence < 0.7 ? (
                    <span className="ml-2 text-xs text-amber-700">Please check</span>
                  ) : null}
                </p>
              ))}
              {proposal.corrections.map((c) => (
                <p key={c.index} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="text-muted-foreground">You told us: </span>
                    {c.label}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => act({ kind: 'undo', index: c.index })}
                  >
                    <Undo2 /> Undo
                  </Button>
                </p>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="grid gap-2" aria-labelledby="chat">
        <h2 id="chat" className="text-lg font-semibold">
          Anything look wrong?
        </h2>
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = note.trim();
            if (text)
              perform(
                () => reviewAction(slug, runId, proposal.id, { kind: 'note', text }),
                () => {
                  setNote('');
                  onAction();
                },
              );
          }}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Tell me in your own words, e.g. “the Etsy prices include shipping”."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label="Tell us what looks wrong"
            disabled={disabled}
          />
          <div>
            <Button type="submit" variant="outline" disabled={disabled || note.trim() === ''}>
              <Sparkles /> Fix it
            </Button>
          </div>
        </form>
      </section>

      <div className="sticky bottom-20 z-10 flex flex-wrap gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur md:bottom-4">
        <Button
          size="lg"
          disabled={disabled || proposal.entities.length === 0}
          onClick={() => perform(() => approveImport(slug, runId, proposal.id), onApproved)}
        >
          Looks good, set it up
        </Button>
        <Button
          size="lg"
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            perform(
              () => cancelImport(slug, runId),
              () => router.push(`/w/${slug}/data/import` as Route),
            )
          }
        >
          Start over with different files
        </Button>
      </div>
    </div>
  );
}

function EntityCard({
  entity,
  fieldOptions,
  currency,
  disabled,
  act,
}: {
  entity: Proposal['entities'][number];
  fieldOptions: { key: string; label: string }[];
  currency: string;
  disabled: boolean;
  act: (a: ReviewAction) => void;
}) {
  const noun = (entity.count === 1 ? entity.label.singular : entity.label.plural).toLowerCase();
  const where = [
    ...new Set(
      entity.sources.map((s) =>
        s.sheet === s.fileName ? s.fileName : `${s.fileName} › ${s.sheet}`,
      ),
    ),
  ];
  return (
    <Card data-testid={`entity-${entity.key}`}>
      <CardHeader>
        <CardTitle className="text-base">
          {fmt.format(entity.count)} {noun}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          From{' '}
          {where
            .slice(0, 2)
            .map((w) => `“${w}”`)
            .join(', ')}
          {where.length > 2 ? ` and ${where.length - 2} more` : ''}
        </p>
        {entity.merged > 0 ? (
          <p className="text-xs text-muted-foreground">
            {fmt.format(entity.merged)} duplicates merged
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2">
          {entity.examples.map((ex, i) => (
            <dl
              key={i}
              className="grid grid-cols-[auto_1fr] gap-x-3 rounded-md bg-muted/50 px-3 py-2 text-xs"
            >
              {ex.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="truncate">{showValue(f, currency)}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-primary">Show details</summary>
          {entity.mapping.map((m) => (
            <ul key={m.sourceId} className="mt-2 grid gap-2">
              {m.fields.map((f) => (
                <li key={f.field} className="grid gap-1 border-b pb-2 last:border-0">
                  <p>
                    {f.from} → <strong>{f.label}</strong>
                    {f.confidence < 0.7 ? (
                      <span className="ml-2 text-xs text-amber-700">Please check</span>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {f.column !== undefined ? (
                      <select
                        aria-label={`What ${f.from} really is`}
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        disabled={disabled}
                        value=""
                        onChange={(e) => {
                          const target = fieldOptions.find((o) => o.key === e.target.value);
                          if (!target || f.column === undefined) return;
                          act({
                            kind: 'correct',
                            label: `${f.from} is the ${target.label.toLowerCase()}.`,
                            effect: {
                              kind: 'map_column',
                              sourceId: m.sourceId,
                              entity: entity.key,
                              field: target.key,
                              column: f.column,
                            },
                          });
                        }}
                      >
                        <option value="">This is actually…</option>
                        {fieldOptions
                          .filter((o) => o.key !== f.field)
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        act({
                          kind: 'correct',
                          label: `Don’t bring in the ${f.label.toLowerCase()} from ${f.from}.`,
                          effect: {
                            kind: 'unmap_field',
                            sourceId: m.sourceId,
                            entity: entity.key,
                            field: f.field,
                          },
                        })
                      }
                    >
                      Don’t bring this in
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </details>
      </CardContent>
    </Card>
  );
}

function showValue(f: { value: string; type: string }, currency: string): string {
  if (f.type !== 'money') return f.value;
  const n = Number(f.value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
    : f.value;
}
