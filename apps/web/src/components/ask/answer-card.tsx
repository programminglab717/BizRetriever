'use client';

import type { AnswerView } from '@bizr/core/ask';
import { ChevronDown, Download, Pin, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { feedbackAction, pinAction, unpinAction } from '@/app/w/[slug]/ask/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useCanChange } from '@/components/shell/can-change';
import { Notes } from '@/components/team/notes';

import { AnswerChart, AnswerTable, KpiCards, type NumberStyle } from './answer-chart';

const REASONS: { id: string; label: string }[] = [
  { id: 'wrong_numbers', label: 'The numbers look wrong' },
  { id: 'misunderstood', label: 'It misunderstood me' },
  { id: 'wrong_period', label: 'Wrong dates' },
  { id: 'hard_to_read', label: 'Hard to read' },
  { id: 'other', label: 'Something else' },
];

export interface Toast {
  text: string;
  link?: { href: string; label: string };
  undo?: () => void;
}

function Headline({ answer }: { answer: AnswerView }) {
  if (!answer.headline) return null;
  return (
    <p className="text-lg leading-relaxed">
      {answer.headline.map((s, i) =>
        s.fact ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>,
      )}
    </p>
  );
}

/** One answer: headline, chart or table, assumptions, "How I calculated this" and actions. */

export function AnswerCard({
  slug,
  answer,
  style,
  onChoose,
  onFollowUp,
  onToast,
  busy,
}: {
  slug: string;
  answer: AnswerView;
  style: NumberStyle;
  onChoose: (answerId: string, option: number) => void;
  onFollowUp: () => void;
  onToast: (t: Toast) => void;
  busy: boolean;
}) {
  const editor = useCanChange();
  const [asTable, setAsTable] = useState(false);
  const [feedback, setFeedback] = useState(answer.feedback);
  const [askWhy, setAskWhy] = useState(false);
  const [pinned, setPinned] = useState(answer.pinned);
  const [pending, start] = useTransition();

  const sendFeedback = (value: 1 | -1 | null, reason?: string) =>
    start(async () => {
      const r = await feedbackAction(slug, answer.id, value, reason);
      if (r.error) onToast({ text: r.error });
      else {
        setFeedback(value);
        if (reason || value === 1) onToast({ text: 'Thanks, that helps us get better.' });
      }
    });

  const pin = () =>
    start(async () => {
      const r = await pinAction(slug, answer.id);
      if (!r.tileId) return onToast({ text: r.error ?? 'That couldn’t be added.' });
      setPinned(true);
      const tileId = r.tileId;
      onToast({
        text: 'Added to your dashboard.',
        link: { href: `/w/${slug}/dashboard`, label: 'View' },
        undo: () =>
          void unpinAction(slug, tileId).then(() => {
            setPinned(false);
            onToast({ text: 'Removed from your dashboard.' });
          }),
      });
    });

  if (answer.kind === 'clarify' && answer.clarify)
    return (
      <Card data-testid="clarify-card">
        <CardContent className="grid gap-4 pt-6">
          <p className="text-lg">{answer.clarify.question}</p>
          <div className="flex flex-wrap gap-2">
            {answer.clarify.options.map((label, i) => (
              <Button
                key={label}
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => onChoose(answer.id, i)}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    );

  if (answer.kind === 'unanswerable' && answer.unanswerable?.reason === 'change_request')
    return (
      <Card data-testid="handoff-card">
        <CardContent className="grid gap-4 pt-6">
          <p className="text-lg">{answer.unanswerable.message}</p>
          <div>
            <Button asChild>
              <Link href={`/w/${slug}/data?do=${encodeURIComponent(answer.question)}` as Route}>
                Do it in My data
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  if (answer.kind === 'unanswerable' && answer.unanswerable)
    return (
      <Card data-testid="unanswerable-card">
        <CardContent className="grid gap-4 pt-6">
          <p className="text-lg">{answer.unanswerable.message}</p>
          {answer.unanswerable.reason === 'missing_data' && (
            <div>
              <Button asChild variant="outline">
                <Link href={`/w/${slug}/data/import`}>Add a file</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );

  if (answer.kind === 'error')
    return (
      <Card data-testid="error-card">
        <CardContent className="pt-6">
          <p>{answer.error ?? 'That one didn’t work. Please try asking in a different way.'}</p>
        </CardContent>
      </Card>
    );

  const chart = answer.chart ?? 'table';
  return (
    <Card data-testid="answer-card">
      <CardContent className="grid gap-5 pt-6">
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {answer.title}
            {answer.kind === 'estimate' && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
                Estimate
              </span>
            )}
          </p>
          <Headline answer={answer} />
        </div>

        {answer.table &&
          (chart === 'kpi' && answer.kpis?.length && !asTable ? (
            <KpiCards
              kpis={answer.kpis}
              {...(answer.comparedWith ? { comparedWith: answer.comparedWith } : {})}
            />
          ) : asTable ? (
            <AnswerTable table={answer.table} caption={answer.title} />
          ) : (
            <AnswerChart chart={chart} table={answer.table} title={answer.title} style={style} />
          ))}
        {answer.table && chart !== 'table' && (
          <div>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setAsTable((v) => !v)}
            >
              {asTable ? 'Show as chart' : 'Show as table'}
            </Button>
          </div>
        )}

        {answer.assumptions.length > 0 && (
          <ul className="grid gap-1 text-sm text-muted-foreground" aria-label="What I assumed">
            {answer.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}

        {answer.steps && (
          <details className="group rounded-lg border px-4 py-3 text-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
              How I calculated this
              <ChevronDown
                className="size-4 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="mt-3 grid gap-3">
              {answer.details?.custom && (
                <p className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs">
                  Custom calculation
                </p>
              )}
              <ol className="grid list-decimal gap-1 pl-5">
                {answer.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {answer.details && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Details</summary>
                  <p className="mt-2 text-muted-foreground">
                    {answer.details.rows} {answer.details.rows === 1 ? 'line' : 'lines'} in the
                    result.
                  </p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                    {answer.details.sql}
                  </pre>
                </details>
              )}
            </div>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {answer.kind === 'query' && editor && (
            <Button variant="outline" size="sm" onClick={pin} disabled={pinned || pending}>
              <Pin /> {pinned ? 'On your dashboard' : 'Add to dashboard'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onFollowUp}>
            Ask a follow-up
          </Button>
          {answer.table && <DownloadLinks href={`/api/w/${slug}/answers/${answer.id}/download`} />}
          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Good answer"
              aria-pressed={feedback === 1}
              className={cn(feedback === 1 && 'text-emerald-700')}
              onClick={() => sendFeedback(feedback === 1 ? null : 1)}
              disabled={pending}
            >
              <ThumbsUp />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Not right"
              aria-pressed={feedback === -1}
              className={cn(feedback === -1 && 'text-destructive')}
              onClick={() => (feedback === -1 ? sendFeedback(null) : setAskWhy(true))}
              disabled={pending}
            >
              <ThumbsDown />
            </Button>
          </span>
        </div>
        {askWhy && (
          <div className="grid gap-2" role="group" aria-label="What was wrong?">
            <p className="text-sm font-medium">What was wrong?</p>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <Button
                  key={r.id}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAskWhy(false);
                    sendFeedback(-1, r.id);
                  }}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          </div>
        )}
        <Notes slug={slug} subject={{ kind: 'answer', id: answer.id }} />
      </CardContent>
    </Card>
  );
}

/** "Download: Excel · CSV" for an answer or a tile. Plain links, so the browser saves the file. */
export function DownloadLinks({ href }: { href: string }) {
  return (
    <span className="flex items-center gap-1 text-sm text-muted-foreground">
      <Download className="size-4" aria-hidden />
      <span>Download:</span>
      <a
        className="rounded px-1 font-medium text-foreground underline-offset-4 hover:underline"
        href={`${href}?format=xlsx`}
        download
      >
        Excel
      </a>
      <span aria-hidden>·</span>
      <a
        className="rounded px-1 font-medium text-foreground underline-offset-4 hover:underline"
        href={`${href}?format=csv`}
        download
      >
        CSV
      </a>
    </span>
  );
}
