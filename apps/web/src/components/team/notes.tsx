'use client';

import type { NoteView } from '@bizr/core/team';
import { Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { Fragment, useRef, useState, useTransition } from 'react';

import {
  addNoteAction,
  loadNotesAction,
  mentionablePeople,
  removeNoteAction,
} from '@/app/w/[slug]/team-actions';
import { Button } from '@/components/ui/button';

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const MAX = 1000;

/** The "@na" being typed just before the cursor, if any (names can have one space in them). */
function typedMention(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase() } : null;
}

/** The note as written, with "@Name" shown as a mention for the people it names. */
function NoteBody({ body, mentions }: { body: string; mentions: string[] }) {
  if (mentions.length === 0) return <>{body}</>;
  const names = [...mentions].sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `(${names.map((n) => `@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')})`,
    'giu',
  );
  return (
    <>
      {body.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-primary/10 px-0.5 font-medium text-primary">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Notes on an insight or an answer (M13): what people in the business wrote, as they wrote it
 * (plain text). Everyone can add one, viewers too. Loads when opened unless the page passed them.
 */
export function Notes({
  slug,
  subject,
  initial,
}: {
  slug: string;
  subject: { kind: 'insight' | 'answer'; id: string };
  initial?: NoteView[];
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<NoteView[] | undefined>(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [typing, setTyping] = useState<{ start: number; query: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const matches = typing
    ? people.filter((p) => p.name.toLowerCase().includes(typing.query)).slice(0, 5)
    : [];
  const pick = (name: string) => {
    if (!typing) return;
    const caret = box.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, typing.start)}@${name} ${text.slice(caret)}`.slice(0, MAX);
    setText(next);
    setTyping(null);
    requestAnimationFrame(() => {
      const at = typing.start + name.length + 2;
      box.current?.focus();
      box.current?.setSelectionRange(at, at);
    });
  };
  const label = `Notes${notes?.length ? ` (${notes.length})` : ''}`;

  const run = (fn: () => ReturnType<typeof loadNotesAction>, then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setNotes(r.data);
      then?.();
    });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !notes) run(() => loadNotesAction(slug, subject));
    if (next && people.length === 0)
      void mentionablePeople(slug).then((r) => r.ok && setPeople(r.data));
  };

  return (
    <div className="grid gap-2 text-sm" data-testid="notes">
      <div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="-ml-2 text-muted-foreground"
          aria-expanded={open}
          onClick={toggle}
        >
          <MessageSquare /> {label}
        </Button>
      </div>
      {open && (
        <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
          {!notes && pending ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          ) : notes?.length ? (
            <ul className="grid gap-2" aria-label="Notes">
              {notes.map((n) => (
                <li key={n.id} className="grid gap-0.5">
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {n.author ?? 'Someone who left'}
                    </span>
                    {when.format(new Date(n.createdAt))}
                    {n.canRemove && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-7"
                        aria-label="Delete this note"
                        disabled={pending}
                        onClick={() => run(() => removeNoteAction(slug, subject, n.id))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </span>
                  <p className="whitespace-pre-wrap break-words">
                    <NoteBody body={n.body} mentions={n.mentions} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No notes yet.</p>
          )}
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim())
                run(
                  () => addNoteAction(slug, subject, text),
                  () => setText(''),
                );
            }}
          >
            <textarea
              ref={box}
              value={text}
              onChange={(e) => {
                const value = e.target.value.slice(0, MAX);
                setText(value);
                setTyping(typedMention(value, e.target.selectionStart ?? value.length));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setTyping(null);
                if (e.key === 'Enter' && matches.length > 0 && typing) {
                  e.preventDefault();
                  pick(matches[0]!.name);
                }
              }}
              rows={2}
              maxLength={MAX}
              placeholder="Add a note for your team, e.g. “Ordered 50 more, arriving Friday”. Type @ to mention someone."
              aria-label="Add a note"
              className="w-full rounded-md border bg-background px-3 py-2 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {matches.length > 0 && (
              <ul
                className="grid gap-0.5 rounded-md border bg-background p-1"
                aria-label="Mention someone"
              >
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full rounded px-2 py-1 text-left hover:bg-muted"
                      onClick={() => pick(p.name)}
                    >
                      @{p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button type="submit" size="sm" disabled={pending || !text.trim()}>
                Add note
              </Button>
            </div>
          </form>
          {error && <p className="text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
