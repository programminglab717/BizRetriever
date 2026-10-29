'use client';

import type { ApiKeyView } from '@bizr/core/platform';
import { Fragment, useState, useTransition } from 'react';

import { createKeyAction, revokeKeyAction } from '@/app/w/[slug]/settings/apps/actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { SecretOnce } from './secret-once';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

/** A translated sentence with `{name}` placeholders shown as code. */
function withCode(text: string, codes: Record<string, string>) {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const code = codes[part.slice(1, -1)];
    return code !== undefined && /^\{\w+\}$/.test(part) ? (
      <code key={i}>{code}</code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

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
  const t = useT();
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
        <CardTitle>{t('Keys')}</CardTitle>
        <CardDescription>
          {t(
            'A key lets another app read this business’s numbers, measures, insights and dashboard. Give each app its own key, so you can turn one off without the others noticing.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {keys.length === 0 ? (
          <p className="text-muted-foreground">{t('No keys yet.')}</p>
        ) : (
          <ul className="grid divide-y" aria-label={t('Keys')}>
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="grid">
                  <span className="font-medium">{k.name}</span>
                  <span className="text-muted-foreground">
                    {k.prefix}… · {t('made {date}', { date: when.format(new Date(k.createdAt)) })} ·{' '}
                    {k.lastUsedAt
                      ? t('last used {date}', { date: when.format(new Date(k.lastUsedAt)) })
                      : t('not used yet')}
                  </span>
                </span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => revoke(k.id)}>
                  {t('Revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {fresh ? <SecretOnce label={t('Your new key')} value={fresh} /> : null}
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field
            id="key-name"
            label={t('What will use it?')}
            hint={t('For example: Accounting add-on')}
          >
            <Input
              id="key-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={pending || !name.trim()}>
            {t('Make a key')}
          </Button>
        </form>
        {error && <p className="text-destructive">{error}</p>}
        <p className="text-muted-foreground">
          {withCode(t('For developers: the address is {url}, with the key sent as {header}.'), {
            url: apiUrl,
            // i18n-skip
            header: 'Authorization: Bearer …',
          })}{' '}
          <a className="underline" href={docsUrl}>
            {t('Description of every call')}
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
