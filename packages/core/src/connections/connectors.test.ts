import { getEnv, resetEnvCache } from '@bizr/platform';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { safeFetch } from './fetch';
import { oauthProvider, oauthProviders } from './oauth/registry';
import { currencyPlaces } from './square';
import { normalizeStore, wooEnabled } from './woocommerce';
import { fromMinor } from './workbook';
import { xeroDay, XERO_SCOPES } from './xero';

// Load the repo's .env files first, so the snapshot has the database settings.
getEnv();
const saved = { ...process.env };
const KEYS = {
  CONNECTOR_SECRET: 'unit-connector-secret-0123456789abcdef',
  APP_URL: 'https://app.example.test',
  QUICKBOOKS_CLIENT_ID: 'qb-id',
  QUICKBOOKS_CLIENT_SECRET: 'qb-secret',
  XERO_CLIENT_ID: 'xero-id',
  XERO_CLIENT_SECRET: 'xero-secret',
  SQUARE_APPLICATION_ID: 'sq-id',
  SQUARE_APPLICATION_SECRET: 'sq-secret',
};
const withEnv = (vars: Record<string, string | undefined>) => {
  process.env = { ...saved };
  for (const [k, v] of Object.entries(vars))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  resetEnvCache();
};
afterEach(() => withEnv({}));
afterAll(() => {
  process.env = saved;
  resetEnvCache();
});

describe('switching sources on', () => {
  it('shows nothing without keys, and each one once its keys are set', () => {
    withEnv({
      CONNECTOR_SECRET: undefined,
      QUICKBOOKS_CLIENT_ID: undefined,
      XERO_CLIENT_ID: undefined,
      SQUARE_APPLICATION_ID: undefined,
      APP_URL: 'http://localhost:3000',
    });
    expect(Object.values(oauthProviders).filter((p) => p.enabled())).toEqual([]);
    expect(wooEnabled()).toBe(false);
    withEnv(KEYS);
    expect(Object.values(oauthProviders).map((p) => p.enabled())).toEqual([true, true, true]);
    expect(wooEnabled()).toBe(true);
    // Keys without the connector secret: tokens couldn't be kept sealed, so off.
    withEnv({ ...KEYS, CONNECTOR_SECRET: undefined });
    expect(Object.values(oauthProviders).some((p) => p.enabled())).toBe(false);
  });

  it('asks each provider for read access only, and comes back to our own address', () => {
    withEnv(KEYS);
    const qb = new URL(oauthProviders.quickbooks.authorizeUrl('s1'));
    expect(qb.origin).toBe('https://appcenter.intuit.com');
    expect(qb.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(qb.searchParams.get('redirect_uri')).toBe(
      'https://app.example.test/api/connect/quickbooks/callback',
    );
    const xero = new URL(oauthProviders.xero.authorizeUrl('s2'));
    expect(xero.searchParams.get('scope')!.split(' ')).toEqual(XERO_SCOPES);
    expect(
      XERO_SCOPES.filter((s) => s.startsWith('accounting.')).every((s) => s.endsWith('.read')),
    ).toBe(true);
    const sq = new URL(oauthProviders.square.authorizeUrl('s3'));
    expect(
      sq.searchParams
        .get('scope')!
        .split(' ')
        .every((s) => s.endsWith('_READ')),
    ).toBe(true);
    expect(sq.searchParams.get('session')).toBe('false');
    expect(oauthProvider('shopify')).toBeNull();
    expect(oauthProvider('__proto__')).toBeNull();
  });
});

describe('WooCommerce store addresses', () => {
  it('takes what owners type', () => {
    expect(normalizeStore('shop.example.com')).toBe('https://shop.example.com');
    expect(normalizeStore('https://Example.com/shop/wp-admin/')).toBe('https://example.com');
    expect(normalizeStore('https://example.com/store/wp-admin')).toBe('https://example.com/store');
  });

  it('refuses http, odd ports, passwords and private or internal places', () => {
    for (const s of [
      '',
      'http://shop.example.com',
      'https://shop.example.com:8443',
      'https://user:pw@shop.example.com',
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.8',
      'https://169.254.169.254',
      'https://[::1]',
      'https://intranet',
      'https://nas.local',
      'https://wp.internal',
      'javascript:alert(1)',
    ])
      expect(normalizeStore(s), s).toBeNull();
  });

  it('never connects to a private address, even when a public-looking name points there', async () => {
    for (const url of ['https://localhost/wp-json/', 'https://127.0.0.1/wp-json/'])
      await expect(
        safeFetch(url, {
          allowHost: () => true,
          maxBytes: 1000,
          publicOnly: true,
          timeoutMs: 2000,
        }),
      ).rejects.toThrow(/couldn’t reach/);
  });
});

describe('money and dates from sources', () => {
  it('turns the smallest currency unit into exact decimals', () => {
    expect(fromMinor(1800)).toBe('18.00');
    expect(fromMinor(5)).toBe('0.05');
    expect(fromMinor(-250)).toBe('-2.50');
    expect(fromMinor('123456789012345678')).toBe('1234567890123456.78');
    expect(fromMinor(1500, currencyPlaces('JPY'))).toBe('1500');
    expect(fromMinor(1234, currencyPlaces('KWD'))).toBe('1.234');
    expect(fromMinor('12.5')).toBeNull();
    expect(currencyPlaces('nonsense')).toBe(2);
  });

  it('reads Xero’s dates either way', () => {
    expect(xeroDay('2026-10-01T00:00:00')).toBe('2026-10-01');
    expect(xeroDay(undefined, '/Date(1790812800000+0000)/')).toBe('2026-10-01');
    expect(xeroDay(undefined, 'garbage')).toBeNull();
  });
});
