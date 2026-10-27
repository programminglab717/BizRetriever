import { resetEnvCache } from '@bizr/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { checkWebhookUrl, postWebhook, signWebhook, verifyWebhookSignature } from './webhooks';

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"id":"insight:1","type":"insight.created"}';
  const now = Date.parse('2026-10-27T12:00:00Z');
  const t = Math.floor(now / 1000);

  it('checks out when the body and secret match, and only then', () => {
    const header = `t=${t},v1=${signWebhook(secret, t, body)}`;
    expect(verifyWebhookSignature(secret, header, body, now)).toBe(true);
    expect(verifyWebhookSignature('whsec_other', header, body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, header, `${body} `, now)).toBe(false);
    expect(verifyWebhookSignature(secret, null, body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, 't=abc,v1=00', body, now)).toBe(false);
  });

  it('refuses an old delivery replayed later', () => {
    const header = `t=${t},v1=${signWebhook(secret, t, body)}`;
    expect(verifyWebhookSignature(secret, header, body, now + 6 * 60_000)).toBe(false);
  });
});

describe('webhook addresses', () => {
  afterEach(() => {
    delete process.env.WEBHOOKS_ALLOW_PRIVATE;
    resetEnvCache();
  });

  it('takes public https addresses', () => {
    expect(checkWebhookUrl(' https://hooks.example.com/bizr#x ')).toBe(
      'https://hooks.example.com/bizr',
    );
  });

  it('refuses http, credentials and private or internal places', () => {
    for (const url of [
      'http://hooks.example.com/',
      'https://user:pass@hooks.example.com/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/',
      'https://[::1]/',
      'https://printer.local/',
      'https://metadata.google.internal/',
      'https://intranet/',
      'ftp://hooks.example.com/',
      'not a url',
    ])
      expect(() => checkWebhookUrl(url), url).toThrow();
  });

  it('never connects to a name that points at a private address', async () => {
    const r = await postWebhook('https://localhost:9/', {}, '{}');
    expect(r).toMatchObject({ ok: false, error: 'That address is on a private network.' });
    const ip = await postWebhook('https://127.0.0.1:9/', {}, '{}');
    expect(ip).toMatchObject({ ok: false, error: 'That address is on a private network.' });
  });

  it('allows localhost only when switched on for local development', () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE = 'on';
    resetEnvCache();
    expect(checkWebhookUrl('http://127.0.0.1:4000/hook')).toBe('http://127.0.0.1:4000/hook');
  });
});
