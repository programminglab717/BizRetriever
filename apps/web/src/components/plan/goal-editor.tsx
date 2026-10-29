'use client';

import { useId, useState, useTransition } from 'react';

import { removeGoalAction, setGoalAction } from '@/app/w/[slug]/plan/actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Set, change or remove a monthly goal for one measure. */
export function GoalEditor({
  slug,
  metricKey,
  label,
  current,
  money,
}: {
  slug: string;
  metricKey: string;
  label: string;
  current: string | null;
  money: boolean;
}) {
  const t = useT();
  const id = useId();
  const [editing, setEditing] = useState(current === null);
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(null);
      const r = await setGoalAction(slug, metricKey, value);
      if (!r.ok) setError(r.error);
      else setEditing(false);
    });
  const remove = () =>
    start(async () => {
      const r = await removeGoalAction(slug, metricKey);
      if (!r.ok) setError(r.error);
    });
  if (!editing)
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
          {t('Change goal')}
        </Button>
        <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
          {t('Remove goal')}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) save();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {current === null
          ? t('A monthly goal for {measure}', { measure: label.toLowerCase() })
          : t('New monthly goal for {measure}', { measure: label.toLowerCase() })}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          inputMode="decimal"
          className="w-40"
          placeholder={money ? '12000' : '400'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" size="sm" disabled={pending || !value.trim()}>
          {pending ? t('Saving…') : t('Save goal')}
        </Button>
        {current !== null && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t('Cancel')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
