import { quickbooks } from '../quickbooks';
import { square } from '../square';
import { xero } from '../xero';
import type { OAuthKind, OAuthProvider } from './provider';

/** The sources connected through their own sign-in (M18). Shopify has its own flow (ADR-059). */
export const oauthProviders: Record<OAuthKind, OAuthProvider> = { quickbooks, xero, square };

/** The provider for a URL segment, if it is one. */
export function oauthProvider(name: string): OAuthProvider | null {
  return Object.hasOwn(oauthProviders, name) ? oauthProviders[name as OAuthKind] : null;
}
