'use client';

import type { FieldMeta } from '@bizr/core/records';
import { useEffect, useRef, useState } from 'react';

import { findRecords } from '@/app/w/[slug]/data/[entity]/actions';
import { useT } from '@/components/i18n/provider';
import { cn } from '@/lib/utils';

import { editorValue, isNumeric, valueLabel } from './format';

const inputClass =
  'h-9 w-full min-w-32 rounded-md border bg-background px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * A type-aware editor for one detail (PRODUCT_SPEC §4.2): a list for allowed values and yes/no, a
 * date or date-and-time picker, a number box, or a search for a linked record. Enter saves, Esc
 * cancels; the server checks the value again.
 */
export function FieldEditor({
  slug,
  field,
  value,
  linkTitle,
  error,
  busy,
  onSave,
  onCancel,
}: {
  slug: string;
  field: FieldMeta;
  value: string | null;
  /** For a linked record: the current one's name. */
  linkTitle?: string | null;
  error: string | null;
  busy: boolean;
  onSave: (value: string | boolean | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const label = t('New {detail}', { detail: t.text(field.label).toLowerCase() });
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  let editor: React.ReactNode;
  if (field.type === 'reference' && field.references)
    editor = (
      <LinkPicker
        slug={slug}
        entity={field.references}
        label={label}
        initial={linkTitle ?? ''}
        required={field.required}
        onPick={onSave}
        onCancel={onCancel}
      />
    );
  else if (field.type === 'boolean' || field.allowedValues?.length) {
    const options =
      field.type === 'boolean'
        ? [
            { v: 'true', l: t('Yes') },
            { v: 'false', l: t('No') },
          ]
        : field.allowedValues!.map((v) => ({ v, l: valueLabel(field, v, t) }));
    editor = (
      <select
        autoFocus
        aria-label={label}
        className={inputClass}
        defaultValue={value ?? ''}
        disabled={busy}
        onKeyDown={keys}
        onChange={(e) => onSave(e.target.value === '' ? null : e.target.value)}
        onBlur={onCancel}
      >
        {!field.required || value === null ? (
          <option value="">{field.required ? t('Choose…') : t('Blank')}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    );
  } else
    editor = (
      <TextEditor
        field={field}
        label={label}
        initial={editorValue(field, value)}
        busy={busy}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  return (
    <div className="grid gap-1">
      {editor}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TextEditor({
  field,
  label,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  field: FieldMeta;
  label: string;
  initial: string;
  busy: boolean;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const type =
    field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return (
    <input
      autoFocus
      aria-label={label}
      type={type}
      // i18n-skip
      inputMode={isNumeric(field) ? 'decimal' : undefined}
      className={cn(inputClass, isNumeric(field) && 'text-right')}
      value={text}
      disabled={busy}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => {
        if (type === 'text') e.target.select();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (text === initial) onCancel();
          else onSave(text);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (text === initial) onCancel();
        else onSave(text);
      }}
    />
  );
}

function LinkPicker({
  slug,
  entity,
  label,
  initial,
  required,
  onPick,
  onCancel,
}: {
  slug: string;
  entity: string;
  label: string;
  initial: string;
  required: boolean;
  onPick: (id: string | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState(initial);
  const [options, setOptions] = useState<{ id: string; title: string }[]>([]);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      void findRecords(slug, entity, q).then((r) => {
        if (!stale && r.ok) {
          setOptions(r.data);
          setActive(0);
        }
      });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [slug, entity, q]);
  return (
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget)) onCancel();
      }}
    >
      <input
        autoFocus
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls="link-options"
        aria-label={label}
        className={inputClass}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const o = options[active];
            if (o) onPick(o.id);
            else if (q.trim() === '' && !required) onPick(null);
          }
        }}
      />
      {options.length > 0 || (!required && q.trim() === '') ? (
        <ul
          id="link-options"
          role="listbox"
          className="absolute z-20 mt-1 grid max-h-60 w-full min-w-48 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
        >
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={cn(
                  'w-full rounded px-2 py-1.5 text-left hover:bg-muted',
                  i === active && 'bg-muted',
                )}
                onClick={() => onPick(o.id)}
              >
                {o.title}
              </button>
            </li>
          ))}
          {!required ? (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted"
                onClick={() => onPick(null)}
              >
                {t('No link')}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
