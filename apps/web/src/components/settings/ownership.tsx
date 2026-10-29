'use client';

import type { TransferView } from '@bizr/core/team';
import { useState, useTransition } from 'react';

import {
  answerOwnership,
  cancelOwnership,
  offerOwnership,
} from '@/app/w/[slug]/settings/ownership-actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

/** The owner hands the business to someone in it (M19). Nothing changes until they accept. */
export function HandOver({
  slug,
  businessName,
  people,
  waiting,
}: {
  slug: string;
  businessName: string;
  people: { id: string; name: string }[];
  waiting: TransferView | null;
}) {
  const t = useT();
  const [to, setTo] = useState(people[0]?.id ?? '');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? t('Please try again.'));
      else setConfirm('');
    });
  const [waitingBefore, waitingAfter] = waiting
    ? t('Waiting for {name} to accept, until {date}.', {
        date: day.format(new Date(waiting.expiresAt)),
      }).split('{name}')
    : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Hand over this business')}</CardTitle>
        <CardDescription>
          {t(
            'Make someone already in the business its owner. Nothing changes until they accept. Then you stay in it as a member.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {waiting ? (
          <div className="grid gap-2" data-testid="handover-waiting">
            <p>
              {waitingBefore}
              <span className="font-medium">{waiting.toName}</span>
              {waitingAfter}
            </p>
            <div>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => act(() => cancelOwnership(slug))}
              >
                {t('Cancel the handover')}
              </Button>
            </div>
          </div>
        ) : people.length === 0 ? (
          <p className="text-muted-foreground">
            {t('Invite the person first: they need to be part of the business.')}
          </p>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => offerOwnership(slug, to, confirm));
            }}
          >
            <Field id="handover-to" label={t('New owner')}>
              <Select id="handover-to" value={to} onChange={(e) => setTo(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="handover-confirm"
              label={t('Type “{name}” to hand it over', { name: businessName })}
            >
              <Input
                id="handover-confirm"
                value={confirm}
                autoComplete="off"
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" disabled={pending || confirm.trim() !== businessName}>
                {t('Ask them to take over')}
              </Button>
            </div>
          </form>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** For the person asked: accept or decline. */
export function TakeOver({
  slug,
  transfer,
  businessName,
}: {
  slug: string;
  transfer: TransferView;
  businessName: string;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const answer = (accept: boolean) =>
    start(async () => {
      setError(null);
      const r = await answerOwnership(slug, transfer.id, accept);
      if (!r.ok) return setError(r.error);
      setDone(
        r.data === 'accepted'
          ? t('You’re now the owner of {name}.', { name: businessName })
          : t('You said no. Nothing changed.'),
      );
    });
  return (
    <Card className="border-primary/40" data-testid="takeover">
      <CardHeader>
        <CardTitle>
          {t('{from} wants to make you the owner of {name}', {
            from: transfer.fromName,
            name: businessName,
          })}
        </CardTitle>
        <CardDescription>
          {t(
            'As the owner you decide who is part of the business, connect other apps, and can delete it.',
          )}{' '}
          {t('{name} stays in it as a member.', { name: transfer.fromName })}{' '}
          {t('Answer by {date}.', { date: day.format(new Date(transfer.expiresAt)) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {done ? (
          <p role="status">{done}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => answer(true)}>
              {t('Become the owner')}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => answer(false)}>
              {t('No thanks')}
            </Button>
          </div>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
