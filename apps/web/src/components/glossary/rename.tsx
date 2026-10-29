'use client';

import type { RenameTarget } from '@bizr/core/semantic';
import { Pencil } from 'lucide-react';
import { useState, useTransition } from 'react';

import { renameAction } from '@/app/w/[slug]/glossary/actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCanChange } from '@/components/shell/can-change';

/** What a rename applies to (plain data, so server pages can pass it). */
export type RenameSubject =
  | { kind: 'measure'; key: string }
  | { kind: 'recordType'; key: string; singular: string; plural: string }
  | { kind: 'detail'; recordType: string; key: string };

/** "Categories" → "Category", "Boxes" → "Box", "Sales" → "Sale". */
function singularOf(plural: string): string {
  const s = plural.trim();
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/(ss|sh|ch|x|z)es$/i.test(s)) return s.replace(/es$/i, '');
  if (/[^s]s$/i.test(s)) return s.slice(0, -1);
  return s;
}

function toTarget(subject: RenameSubject, name: string): RenameTarget {
  switch (subject.kind) {
    case 'measure':
      return { kind: 'measure', key: subject.key, label: name };
    case 'detail':
      return { kind: 'detail', recordType: subject.recordType, key: subject.key, label: name };
    case 'recordType':
      return {
        kind: 'recordType',
        key: subject.key,
        plural: name,
        singular: name.trim() === subject.plural ? subject.singular : singularOf(name),
      };
  }
}

/** A name with a small "Rename" control. Saving changes only what you see, never your data. */
export function Renameable({
  slug,
  value,
  target,
  className,
}: {
  slug: string;
  value: string;
  target: RenameSubject;
  className?: string;
}) {
  const t = useT();
  const editor = useCanChange();
  // Names from your data's setup are shown in the reader's language; your own names as they are.
  const shown = t.text(value);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editor) return <span className={className}>{shown}</span>;
  if (!editing)
    return (
      <span className={className}>
        {shown}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-1 size-7 align-middle text-muted-foreground"
          aria-label={t('Rename {name}', { name: shown })}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3.5" />
        </Button>
      </span>
    );

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          // Saving the shown translation unchanged keeps the name as it is.
          const r = await renameAction(
            slug,
            toTarget(target, name.trim() === shown ? value : name),
          );
          if (r.error) setError(r.error);
          else {
            setError(null);
            setEditing(false);
          }
        });
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        aria-label={t('New name for {name}', { name: shown })}
        className="h-9 max-w-64"
        autoFocus
      />
      <Button type="submit" size="sm" disabled={pending}>
        {t('Save')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setName(shown);
          setEditing(false);
          setError(null);
        }}
      >
        {t('Cancel')}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
  );
}
