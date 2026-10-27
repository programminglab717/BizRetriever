'use client';

import type { NoteView } from '@bizr/core/team';
import { Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { addNoteAction, loadNotesAction, removeNoteAction } from '@/app/w/[slug]/team-actions';
import { Button } from '@/components/ui/button';

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const MAX = 1000;

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
                  <p className="whitespace-pre-wrap break-words">{n.body}</p>
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
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              rows={2}
              maxLength={MAX}
              placeholder="Add a note for your team, e.g. “Ordered 50 more, arriving Friday”"
              aria-label="Add a note"
              className="w-full rounded-md border bg-background px-3 py-2 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
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
