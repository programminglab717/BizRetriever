'use client';

import { useActionState, useState } from 'react';

import type { DeleteState } from '@/app/w/[slug]/settings/actions';
import { useT } from '@/components/i18n/provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Destructive: requires typing the business name (safety rule 3). */
export function DeleteBusiness({
  action,
  name,
}: {
  action: (state: DeleteState, formData: FormData) => Promise<DeleteState>;
  name: string;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, {});
  const [before, after] = t(
    'This permanently deletes {name} and all of its records, files and dashboards.',
  ).split('{name}');
  const [typed, setTyped] = useState('');
  return (
    <form action={formAction} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {before}
        <strong className="text-foreground">{name}</strong>
        {after} {t('This can’t be undone.')}
      </p>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field id="confirm" label={t('Type “{name}” to confirm', { name })}>
        <Input
          id="confirm"
          name="confirm"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending || typed.trim() !== name}
        className="justify-self-start"
      >
        {pending ? t('Deleting…') : t('Delete this business forever')}
      </Button>
    </form>
  );
}
