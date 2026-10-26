import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '@bizr/platform';

import { safeFetch, SourceError } from '../fetch';
import { connectorSecretsEnabled } from '../secret';

/**
 * Shopify's sign-in for apps (ADR-059): the owner installs our Dev Dashboard app on their store;
 * Shopify sends them back with a code we swap for an offline access token. We ask for expiring
 * tokens (60 minutes, with a 90-day refresh token that rotates), as Shopify requires of new apps.
 * Every request goes to the shop's own myshopify.com address, which we validate first.
 */

export const SHOPIFY_SCOPES = ['read_products', 'read_inventory', 'read_orders', 'read_customers'];

export function shopifyEnabled(): boolean {
  const env = getEnv();
  return Boolean(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET && connectorSecretsEnabled());
}

function credentials() {
  const env = getEnv();
  if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET)
    throw new Error('Shopify app credentials are not set');
  return { id: env.SHOPIFY_CLIENT_ID, secret: env.SHOPIFY_CLIENT_SECRET };
}

const SHOP = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

/** "fernwood", "fernwood.myshopify.com" or its admin address → "fernwood.myshopify.com". */
export function normalizeShop(input: string): string | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (/^https?:\/\//.test(text)) {
    try {
      text = new URL(text).hostname;
    } catch {
      return null;
    }
  }
  text = text.replace(/\/.*$/, '');
  if (/^admin\.shopify\.com$/.test(text)) return null;
  if (!text.includes('.')) text = `${text}.myshopify.com`;
  return SHOP.test(text) ? text : null;
}

export function isShopDomain(host: string): boolean {
  return SHOP.test(host);
}

export function callbackUrl(): string {
  return new URL('/api/connect/shopify/callback', getEnv().APP_URL).toString();
}

export function authorizeUrl(shop: string, state: string): string {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', credentials().id);
  url.searchParams.set('scope', SHOPIFY_SCOPES.join(','));
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('state', state);
  return url.toString();
}

const hexEqual = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Shopify signs the callback: an HMAC-SHA256 (hex, app secret) of every query parameter except
 * `hmac`, sorted by name and joined as `name=value&…`.
 */
export function verifyCallback(params: URLSearchParams): boolean {
  const hmac = params.get('hmac');
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const want = createHmac('sha256', credentials().secret).update(message).digest('hex');
  return hexEqual(want, hmac.toLowerCase());
}

/** Webhooks carry a base64 HMAC-SHA256 of the raw body in `X-Shopify-Hmac-Sha256`. */
export function verifyWebhook(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const want = createHmac('sha256', credentials().secret).update(rawBody, 'utf8').digest('base64');
  return hexEqual(want, header);
}

export interface ShopifyTokens {
  accessToken: string;
  scope: string;
  /** ISO time the access token stops working; absent for a token that doesn't expire. */
  expiresAt?: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
}

interface TokenResponse {
  access_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
}

function toTokens(body: TokenResponse, now: Date): ShopifyTokens {
  if (typeof body.access_token !== 'string' || !body.access_token)
    throw new SourceError(
      'Shopify didn’t give us access. Please try connecting again.',
      'needs_attention',
    );
  const at = (seconds: unknown) =>
    typeof seconds === 'number' && seconds > 0
      ? new Date(now.getTime() + seconds * 1000).toISOString()
      : undefined;
  const expiresAt = at(body.expires_in);
  const refreshExpiresAt = at(body.refresh_token_expires_in);
  return {
    accessToken: body.access_token,
    scope: typeof body.scope === 'string' ? body.scope : '',
    ...(expiresAt ? { expiresAt } : {}),
    ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
    ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
  };
}

async function tokenRequest(shop: string, form: Record<string, string>, now: Date) {
  if (!isShopDomain(shop))
    throw new SourceError('That isn’t a Shopify store address.', 'needs_attention');
  const res = await safeFetch(`https://${shop}/admin/oauth/access_token`, {
    allowHost: (h) => h === shop,
    maxBytes: 64 * 1024,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    maxRedirects: 0,
  });
  if (res.status === 400 || res.status === 401 || res.status === 403)
    throw new SourceError(
      'Shopify no longer lets us in. Please connect your store again.',
      'needs_attention',
    );
  if (res.status !== 200)
    throw new SourceError('Shopify didn’t answer just now. We’ll try again later.');
  let body: TokenResponse;
  try {
    body = JSON.parse(new TextDecoder().decode(res.bytes)) as TokenResponse;
  } catch {
    throw new SourceError('Shopify didn’t answer just now. We’ll try again later.');
  }
  return toTokens(body, now);
}

/** The code from the callback → an offline token (expiring, with a refresh token). */
export function exchangeCode(shop: string, code: string, now = new Date()) {
  const c = credentials();
  return tokenRequest(shop, { client_id: c.id, client_secret: c.secret, code, expiring: '1' }, now);
}

/** A fresh token pair. The old pair stops working: store the new one before using it. */
export function refreshTokens(shop: string, refreshToken: string, now = new Date()) {
  const c = credentials();
  return tokenRequest(
    shop,
    {
      client_id: c.id,
      client_secret: c.secret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
    now,
  );
}
