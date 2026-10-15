/**
 * Only allow redirects to paths on this site (prevents open redirects via `?next=`).
 * Returns undefined for anything that isn't a plain absolute path.
 */
import type { Route } from 'next';

export function safeNextPath(next: string | string[] | undefined | null): Route | undefined {
  if (typeof next !== 'string') return undefined;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return undefined;
  if (/[\r\n]/.test(next)) return undefined;
  return next as Route;
}
