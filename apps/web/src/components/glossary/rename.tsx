'use client';

import type { RenameTarget } from '@bizr/core/semantic';
import { Pencil } from 'lucide-react';
import { useState, useTransition } from 'react';

import { renameAction } from '@/app/w/[slug]/glossary/actions';
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
  const editor = useCanChange();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editor) return <span className={className}>{value}</span>;
  if (!editing)
    return (
      <span className={className}>
        {value}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-1 size-7 align-middle text-muted-foreground"
          aria-label={`Rename ${value}`}
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
          const r = await renameAction(slug, toTarget(target, name));
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
        aria-label={`New name for ${value}`}
        className="h-9 max-w-64"
        autoFocus
      />
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setName(value);
          setEditing(false);
          setError(null);
        }}
      >
        Cancel
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </form>
  );
}
