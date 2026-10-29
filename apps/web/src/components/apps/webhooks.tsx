'use client';

import type { WebhookView } from '@bizr/core/platform';
import { useState, useTransition } from 'react';

import {
  createWebhookAction,
  testWebhookAction,
  updateWebhookAction,
} from '@/app/w/[slug]/settings/apps/actions';
import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { SecretOnce } from './secret-once';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** Webhooks (M16): an https address told when something happens. */
export function Webhooks({
  slug,
  initial,
  events,
}: {
  slug: string;
  /** null: not switched on for this installation. */
  initial: WebhookView[] | null;
  events: Record<string, string>;
}) {
  const t = useT();
  const [hooks, setHooks] = useState(initial ?? []);
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<string[]>(Object.keys(events));
  const [fresh, setFresh] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      setNote(null);
      await fn();
    });
  const add = () =>
    run(async () => {
      const r = await createWebhookAction(slug, { url, events: picked });
      if (!r.ok) return setError(r.error);
      setHooks((h) => [...h, r.data.view]);
      setFresh(r.data.secret);
      setUrl('');
    });
  const change = (id: string, c: 'delete' | 'enable') =>
    run(async () => {
      const r = await updateWebhookAction(slug, id, c);
      if (!r.ok) return setError(r.error);
      setHooks((h) =>
        c === 'delete'
          ? h.filter((x) => x.id !== id)
          : h.map((x) => (x.id === id ? { ...x, disabled: false } : x)),
      );
      if (c === 'delete') setFresh(null);
    });
  const test = (id: string) =>
    run(async () => {
      const r = await testWebhookAction(slug, id);
      if (!r.ok) return setError(r.error);
      setNote(
        r.data.ok
          ? t('Test sent: the address answered OK.')
          : `${t('Test not delivered.')} ${r.data.error ? t.text(r.data.error) : ''}`,
      );
      setHooks((h) =>
        h.map((x) =>
          x.id === id
            ? {
                ...x,
                lastDeliveryAt: new Date(),
                lastStatus: r.data.status,
                lastError: r.data.error,
              }
            : x,
        ),
      );
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Webhooks')}</CardTitle>
        <CardDescription>
          {t(
            'Tell another app straight away when something happens here. Each message is signed, so the app can check it came from us.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {initial === null ? (
          <p className="text-muted-foreground">{t('Webhooks aren’t switched on here yet.')}</p>
        ) : (
          <>
            {hooks.length === 0 ? (
              <p className="text-muted-foreground">{t('No webhooks yet.')}</p>
            ) : (
              <ul className="grid divide-y" aria-label={t('Webhooks')}>
                {hooks.map((h) => (
                  <li key={h.id} className="grid gap-1 py-2">
                    <span className="break-all font-medium">{h.url}</span>
                    <span className="text-muted-foreground">
                      {h.events.map((e) => (events[e] ? t.text(events[e]) : e)).join(' · ')}
                    </span>
                    <span className="text-muted-foreground" data-testid="webhook-status">
                      {h.disabled
                        ? h.lastError
                          ? t('Turned off: it kept failing ({error}).', {
                              error: t.text(h.lastError),
                            })
                          : t('Turned off: it kept failing.')
                        : h.lastDeliveryAt
                          ? h.lastError
                            ? t('Last sent {when}: {error}', {
                                when: when.format(new Date(h.lastDeliveryAt)),
                                error: t.text(h.lastError),
                              })
                            : t('Last sent {when}: answered {status}', {
                                when: when.format(new Date(h.lastDeliveryAt)),
                                status: String(h.lastStatus ?? 'OK'),
                              })
                          : t('Nothing sent yet.')}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => test(h.id)}
                      >
                        {t('Send a test')}
                      </Button>
                      {h.disabled ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => change(h.id, 'enable')}
                        >
                          {t('Turn back on')}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => change(h.id, 'delete')}
                      >
                        {t('Delete')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {fresh ? <SecretOnce label={t('Its signing secret')} value={fresh} /> : null}
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Field
                id="webhook-url"
                label={t('Address to send to')}
                hint={t('It must start with https://')}
              >
                <Input
                  id="webhook-url"
                  type="url"
                  inputMode="url"
                  value={url}
                  // i18n-skip
                  placeholder="https://"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <fieldset className="grid gap-1">
                <legend className="mb-1 font-medium">{t('Tell it when')}</legend>
                {Object.entries(events).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={picked.includes(key)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, key] : p.filter((x) => x !== key),
                        )
                      }
                    />
                    {t.text(label)}
                  </label>
                ))}
              </fieldset>
              <div>
                <Button type="submit" disabled={pending || !url.trim() || picked.length === 0}>
                  {t('Add webhook')}
                </Button>
              </div>
            </form>
          </>
        )}
        {note && (
          <p role="status" data-testid="webhook-note">
            {note}
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
