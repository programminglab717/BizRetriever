'use client';

import type { AnswerView } from '@bizr/core/ask';
import { SendHorizontal } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { askAction } from '@/app/w/[slug]/ask/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { AnswerCard, type Toast } from './answer-card';
import type { NumberStyle } from './answer-chart';

interface Turn {
  question: string;
  answer: AnswerView;
}

function Thinking() {
  const t = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" className="grid gap-3 rounded-xl border p-6">
      <p className="text-muted-foreground">
        {slow ? t('Still working: checking your records…') : t('Working it out…')}
      </p>
      <div className="h-40 animate-pulse rounded-lg bg-muted" aria-hidden />
    </div>
  );
}

/** Ask (PRODUCT_SPEC §2.1): suggestion chips, the conversation, and the question box. */
export function AskThread({
  slug,
  conversationId: initialConversation,
  initial,
  chips,
  style,
  initialQuestion,
}: {
  slug: string;
  conversationId?: string;
  initial: Turn[];
  chips: string[];
  style: NumberStyle;
  /** Prefilled question ("Ask about this" from a dashboard tile). */
  initialQuestion?: string;
}) {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>(initial);
  const [conversationId, setConversationId] = useState(initialConversation);
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length, asking]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const send = (q: string, choice?: { answerId: string; option: number }, shown?: string) => {
    if (!q.trim() && !choice) return;
    setError(null);
    setAsking(shown ?? q);
    start(async () => {
      const r = await askAction(slug, {
        question: q,
        ...(conversationId ? { conversationId } : {}),
        ...(choice ? { choice } : {}),
      });
      setAsking(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (!conversationId) {
        setConversationId(r.conversationId);
        window.history.replaceState(null, '', `/w/${slug}/ask?c=${r.conversationId}`);
      }
      setTurns((prev) => [...prev, { question: r.answer.question, answer: r.answer }]);
      setQuestion('');
    });
  };

  const empty = turns.length === 0 && !asking;
  return (
    <div className="grid grid-cols-1 gap-6 pb-28">
      {empty && (
        <div className="grid gap-4">
          <p className="text-xl">{t('Ask me anything about your business.')}</p>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label={t('Questions you can ask')}>
              {chips.map((c) => (
                <Button
                  key={c}
                  variant="outline"
                  className="h-auto max-w-full shrink whitespace-normal py-2 text-left"
                  // What's asked is what the chip says, in the reader's language.
                  onClick={() => send(t.text(c))}
                >
                  {t.text(c)}
                </Button>
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            <Link className="underline" href={`/w/${slug}/glossary`}>
              {t('What can I ask?')}
            </Link>{' '}
            {t('See everything we can work out from your data.')}
          </p>
        </div>
      )}

      {turns.map((turn) => (
        <section key={turn.answer.id} className="grid gap-3" aria-label={turn.question}>
          <p className="w-fit max-w-[85%] justify-self-end rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
            {turn.question}
          </p>
          <AnswerCard
            slug={slug}
            answer={turn.answer}
            style={style}
            busy={pending}
            onChoose={(answerId, option) =>
              send('', { answerId, option }, t.text(turn.answer.clarify?.options[option] ?? ''))
            }
            onFollowUp={() => input.current?.focus()}
            onToast={setToast}
          />
        </section>
      ))}

      {asking && (
        <section className="grid gap-3">
          <p className="w-fit max-w-[85%] justify-self-end rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
            {asking}
          </p>
          <Thinking />
        </section>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <div ref={end} />

      <form
        className="fixed inset-x-0 bottom-16 z-10 border-t bg-background/95 p-3 backdrop-blur md:bottom-0 md:left-60"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <label htmlFor="ask-input" className="sr-only">
            {t('Your question')}
          </label>
          <textarea
            id="ask-input"
            ref={input}
            rows={1}
            value={question}
            maxLength={500}
            placeholder={
              turns.length
                ? t('Ask a follow-up…')
                : t('Ask about your sales, products, stock or customers…')
            }
            className="max-h-40 min-h-11 flex-1 resize-none rounded-md border bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(e) => {
              setQuestion(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(question);
              }
            }}
          />
          <Button
            type="submit"
            size="lg"
            disabled={pending || !question.trim()}
            aria-label={t('Ask')}
          >
            <SendHorizontal />
          </Button>
        </div>
      </form>

      {toast && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-36 z-20 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg md:right-6 md:bottom-24 md:left-auto"
        >
          <span className="flex-1">{toast.text}</span>
          {toast.link && (
            <Link href={toast.link.href as Route} className="font-medium underline">
              {toast.link.label}
            </Link>
          )}
          {toast.undo && (
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              {t('Undo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
