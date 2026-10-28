import type { ConnectionKind, connection } from '@bizr/db';

import type { Fetched } from '../service';

/**
 * Sources owners connect through the provider's own sign-in (M18, ADR-068): QuickBooks, Xero and
 * Square. Each provider says where to send the owner, how to swap the code for tokens, how to
 * refresh them, and how to read what it holds into a workbook for the normal import. The shared
 * code (`./service.ts`) does the rest: the signed state, every check on the way back, sealed
 * tokens, and refreshing without ever losing a newer pair.
 */

export type Connection = typeof connection.$inferSelect;

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** ISO times. */
  expiresAt?: string;
  refreshExpiresAt?: string;
}

/** Who the connection is for, worked out from the callback and the first tokens. */
export interface ConnectedAccount {
  /** The provider's id for the company, organisation or merchant: one connection each. */
  externalId: string;
  name: string;
  config?: Record<string, unknown>;
}

export type OAuthKind = Extract<ConnectionKind, 'quickbooks' | 'xero' | 'square'>;

export interface OAuthProvider {
  kind: OAuthKind;
  /** "QuickBooks" */
  label: string;
  /** App keys (and the connector secret) are set. Off means the button isn't shown. */
  enabled(): boolean;
  authorizeUrl(state: string): string;
  /** The code from the callback → tokens and whose account it is. */
  connect(
    params: URLSearchParams,
    now: Date,
  ): Promise<{ tokens: OAuthTokens; account: ConnectedAccount }>;
  /** A fresh pair. If the provider rotates refresh tokens, the old one is now dead. */
  refresh(tokens: OAuthTokens, now: Date): Promise<OAuthTokens>;
  /** What it holds now, as files for the import, read with a working access token. */
  read(c: Connection, accessToken: string, now: Date): Promise<Fetched>;
  /** Where the owner can see their account ("Open in QuickBooks"). */
  link?(c: Connection): string | null;
}

/** "expires_in" seconds from a token answer → an ISO time. */
export function expiry(seconds: unknown, now: Date): string | undefined {
  return typeof seconds === 'number' && seconds > 0
    ? new Date(now.getTime() + seconds * 1000).toISOString()
    : undefined;
}
