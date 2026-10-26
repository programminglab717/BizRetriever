import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { getEnv } from '@bizr/platform';

/**
 * Access tokens at rest (ADR-059): AES-256-GCM under a key derived from CONNECTOR_SECRET, which
 * lives only in the environment. A stored value is `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */

function key(): Buffer {
  const secret = getEnv().CONNECTOR_SECRET;
  if (!secret) throw new Error('CONNECTOR_SECRET is not set');
  return createHash('sha256').update(`bizr-connector:${secret}`).digest();
}

export function connectorSecretsEnabled(): boolean {
  return Boolean(getEnv().CONNECTOR_SECRET);
}

export function sealSecret(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function openSecret<T>(sealed: string): T {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const text = Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(text) as T;
}
