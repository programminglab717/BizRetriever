import { safeFetch, SourceError } from './fetch';

/**
 * Google Sheets by share link (ADR-058): no account or key. The owner shares the sheet as "Anyone
 * with the link can view" (or publishes it); we fetch the whole workbook as Excel from an address we
 * build from the sheet's id, on Google's hosts only.
 */

export type SheetRef = { kind: 'doc'; id: string } | { kind: 'published'; id: string };

const DOC = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#]|$)/;
const PUBLISHED = /\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,200})(?:[/?#]|$)/;

/** The sheet a pasted link points to, or null for anything that isn't a Google Sheets link. */
export function parseSheetLink(text: string): SheetRef | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'docs.google.com') return null;
  const pub = PUBLISHED.exec(url.pathname);
  if (pub) return { kind: 'published', id: pub[1]! };
  const doc = DOC.exec(url.pathname);
  return doc && doc[1] !== 'e' ? { kind: 'doc', id: doc[1]! } : null;
}

export function externalIdOf(ref: SheetRef): string {
  return ref.kind === 'doc' ? ref.id : `e/${ref.id}`;
}

export function refOf(externalId: string): SheetRef {
  return externalId.startsWith('e/')
    ? { kind: 'published', id: externalId.slice(2) }
    : { kind: 'doc', id: externalId };
}

export function exportUrl(ref: SheetRef): string {
  return ref.kind === 'doc'
    ? `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=xlsx`
    : `https://docs.google.com/spreadsheets/d/e/${ref.id}/pub?output=xlsx`;
}

const allowHost = (h: string) =>
  h === 'docs.google.com' || h === 'accounts.google.com' || h.endsWith('.googleusercontent.com');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SHEET_MAX_BYTES = 25 * 1024 * 1024;

/** The sheet's title from the download's file name, cleaned up (it's untrusted text). */
export function titleFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plain = /filename="([^"]+)"/i.exec(disposition);
  let name: string | undefined;
  try {
    name = star ? decodeURIComponent(star[1]!) : plain?.[1];
  } catch {
    name = plain?.[1];
  }
  const cleaned = name
    ?.replace(/\.xlsx$/i, '')
    .replace(/[\\/:*?"<>|]|\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || null;
}

export interface FetchedSheet {
  title: string;
  file: { fileName: string; mime: string; bytes: Uint8Array };
}

/** Downloads the whole workbook. Throws SourceError with a message the owner can act on. */
export async function fetchSheet(ref: SheetRef): Promise<FetchedSheet> {
  const res = await safeFetch(exportUrl(ref), { allowHost, maxBytes: SHEET_MAX_BYTES });
  const host = new URL(res.url).hostname;
  const type = res.headers.get('content-type') ?? '';
  if (host === 'accounts.google.com' || res.status === 401 || res.status === 403)
    throw new SourceError(
      'This sheet isn’t shared. In Google Sheets, choose Share → “Anyone with the link” → Viewer, then try again.',
      'needs_attention',
    );
  if (res.status === 404 || res.status === 410)
    throw new SourceError(
      'We couldn’t find this sheet. It may have been deleted, or the link is incomplete.',
      'needs_attention',
    );
  if (res.status >= 500 || res.status === 429)
    throw new SourceError('Google Sheets didn’t answer just now. We’ll try again later.');
  if (res.status !== 200 || !type.startsWith(XLSX))
    throw new SourceError(
      'This sheet isn’t shared. In Google Sheets, choose Share → “Anyone with the link” → Viewer, then try again.',
      'needs_attention',
    );
  const title = titleFrom(res.headers.get('content-disposition')) ?? 'Google Sheet';
  return { title, file: { fileName: `${title}.xlsx`, mime: XLSX, bytes: res.bytes } };
}
