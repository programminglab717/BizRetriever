'use client';

import type { WebhookView } from '@bizr/core/platform';
import { useState, useTransition } from 'react';

import {
  createWebhookAction,
  testWebhookAction,
  updateWebhookAction,
} from '@/app/w/[slug]/settings/apps/actions';
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
          ? 'Test sent: the address answered OK.'
          : `Test not delivered. ${r.data.error ?? ''}`,
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
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          Tell another app straight away when something happens here. Each message is signed, so the
          app can check it came from us.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {initial === null ? (
          <p className="text-muted-foreground">Webhooks aren’t switched on here yet.</p>
        ) : (
          <>
            {hooks.length === 0 ? (
              <p className="text-muted-foreground">No webhooks yet.</p>
            ) : (
              <ul className="grid divide-y" aria-label="Webhooks">
                {hooks.map((h) => (
                  <li key={h.id} className="grid gap-1 py-2">
                    <span className="break-all font-medium">{h.url}</span>
                    <span className="text-muted-foreground">
                      {h.events.map((e) => events[e] ?? e).join(' · ')}
                    </span>
                    <span className="text-muted-foreground" data-testid="webhook-status">
                      {h.disabled
                        ? `Turned off: it kept failing${h.lastError ? ` (${h.lastError})` : ''}.`
                        : h.lastDeliveryAt
                          ? `Last sent ${when.format(new Date(h.lastDeliveryAt))}: ${
                              h.lastError ?? `answered ${h.lastStatus ?? 'OK'}`
                            }`
                          : 'Nothing sent yet.'}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => test(h.id)}
                      >
                        Send a test
                      </Button>
                      {h.disabled ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => change(h.id, 'enable')}
                        >
                          Turn back on
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => change(h.id, 'delete')}
                      >
                        Delete
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {fresh ? <SecretOnce label="Its signing secret" value={fresh} /> : null}
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Field id="webhook-url" label="Address to send to" hint="It must start with https://">
                <Input
                  id="webhook-url"
                  type="url"
                  inputMode="url"
                  value={url}
                  placeholder="https://"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <fieldset className="grid gap-1">
                <legend className="mb-1 font-medium">Tell it when</legend>
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
                    {label}
                  </label>
                ))}
              </fieldset>
              <div>
                <Button type="submit" disabled={pending || !url.trim() || picked.length === 0}>
                  Add webhook
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
