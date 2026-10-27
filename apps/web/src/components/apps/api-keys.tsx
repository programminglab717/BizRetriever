'use client';

import type { ApiKeyView } from '@bizr/core/platform';
import { useState, useTransition } from 'react';

import { createKeyAction, revokeKeyAction } from '@/app/w/[slug]/settings/apps/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { SecretOnce } from './secret-once';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

/** API keys (M16): make one (shown once), see when each was last used, revoke. */
export function ApiKeys({
  slug,
  initial,
  apiUrl,
  docsUrl,
}: {
  slug: string;
  initial: ApiKeyView[];
  apiUrl: string;
  docsUrl: string;
}) {
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const create = () =>
    start(async () => {
      setError(null);
      const r = await createKeyAction(slug, name);
      if (!r.ok) return setError(r.error);
      setKeys((k) => [...k, r.data.view]);
      setFresh(r.data.key);
      setName('');
    });
  const revoke = (id: string) =>
    start(async () => {
      setError(null);
      const r = await revokeKeyAction(slug, id);
      if (!r.ok) return setError(r.error);
      setKeys((k) => k.filter((x) => x.id !== id));
      setFresh(null);
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Keys</CardTitle>
        <CardDescription>
          A key lets another app read this business’s numbers, measures, insights and dashboard.
          Give each app its own key, so you can turn one off without the others noticing.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {keys.length === 0 ? (
          <p className="text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="grid divide-y" aria-label="Keys">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="grid">
                  <span className="font-medium">{k.name}</span>
                  <span className="text-muted-foreground">
                    {k.prefix}… · made {when.format(new Date(k.createdAt))} ·{' '}
                    {k.lastUsedAt
                      ? `last used ${when.format(new Date(k.lastUsedAt))}`
                      : 'not used yet'}
                  </span>
                </span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => revoke(k.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {fresh ? <SecretOnce label="Your new key" value={fresh} /> : null}
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field id="key-name" label="What will use it?" hint="For example: Accounting add-on">
            <Input
              id="key-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={pending || !name.trim()}>
            Make a key
          </Button>
        </form>
        {error && <p className="text-destructive">{error}</p>}
        <p className="text-muted-foreground">
          For developers: the address is <code>{apiUrl}</code>, with the key sent as{' '}
          <code>Authorization: Bearer …</code>.{' '}
          <a className="underline" href={docsUrl}>
            Description of every call
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
