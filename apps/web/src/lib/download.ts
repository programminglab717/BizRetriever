import type { Download, DownloadFormat } from '@bizr/core/export';

/** `?format=csv|xlsx`, Excel when missing. */
export function formatParam(url: URL): DownloadFormat | null {
  const f = url.searchParams.get('format') ?? 'xlsx';
  return f === 'csv' || f === 'xlsx' ? f : null;
}

/** A file to save, never shown inline or cached. */
export function fileResponse(d: Download): Response {
  return new Response(d.body as BodyInit, {
    headers: {
      'Content-Type': d.contentType,
      'Content-Disposition': `attachment; filename="${d.fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const notFound = () => Response.json({ error: 'Not found' }, { status: 404 });
