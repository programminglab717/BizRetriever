'use client';

import type { TransferView } from '@bizr/core/team';
import { useState, useTransition } from 'react';

import {
  answerOwnership,
  cancelOwnership,
  offerOwnership,
} from '@/app/w/[slug]/settings/ownership-actions';
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
  const [to, setTo] = useState(people[0]?.id ?? '');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Please try again.');
      else setConfirm('');
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hand over this business</CardTitle>
        <CardDescription>
          Make someone already in the business its owner. Nothing changes until they accept. Then
          you stay in it as a member.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {waiting ? (
          <div className="grid gap-2" data-testid="handover-waiting">
            <p>
              Waiting for <span className="font-medium">{waiting.toName}</span> to accept, until{' '}
              {day.format(new Date(waiting.expiresAt))}.
            </p>
            <div>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => act(() => cancelOwnership(slug))}
              >
                Cancel the handover
              </Button>
            </div>
          </div>
        ) : people.length === 0 ? (
          <p className="text-muted-foreground">
            Invite the person first: they need to be part of the business.
          </p>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => offerOwnership(slug, to, confirm));
            }}
          >
            <Field id="handover-to" label="New owner">
              <Select id="handover-to" value={to} onChange={(e) => setTo(e.target.value)}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="handover-confirm" label={`Type “${businessName}” to hand it over`}>
              <Input
                id="handover-confirm"
                value={confirm}
                autoComplete="off"
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" disabled={pending || confirm.trim() !== businessName}>
                Ask them to take over
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
          ? `You’re now the owner of ${businessName}.`
          : 'You said no. Nothing changed.',
      );
    });
  return (
    <Card className="border-primary/40" data-testid="takeover">
      <CardHeader>
        <CardTitle>
          {transfer.fromName} wants to make you the owner of {businessName}
        </CardTitle>
        <CardDescription>
          As the owner you decide who is part of the business, connect other apps, and can delete
          it. {transfer.fromName} stays in it as a member. Answer by{' '}
          {day.format(new Date(transfer.expiresAt))}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {done ? (
          <p role="status">{done}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => answer(true)}>
              Become the owner
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => answer(false)}>
              No thanks
            </Button>
          </div>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
