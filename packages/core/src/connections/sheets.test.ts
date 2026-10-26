import { afterEach, describe, expect, it } from 'vitest';

import { settledByMapping } from '../ingestion/linked';
import { safeFetch, setConnectorFetch, SourceError } from './fetch';
import { exportUrl, parseSheetLink, titleFrom } from './sheets';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

describe('parseSheetLink', () => {
  it('reads the links people copy from Google Sheets', () => {
    for (const link of [
      `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`,
      `https://docs.google.com/spreadsheets/d/${ID}`,
      `  https://DOCS.google.com/spreadsheets/d/${ID}/view  `,
    ])
      expect(parseSheetLink(link)).toEqual({ kind: 'doc', id: ID });
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/e/2PACX-${ID}/pubhtml`)).toEqual({
      kind: 'published',
      id: `2PACX-${ID}`,
    });
  });

  it('refuses everything else, so we never fetch an address someone typed', () => {
    for (const link of [
      `http://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com.evil.example/spreadsheets/d/${ID}`,
      `https://evil.example/?u=https://docs.google.com/spreadsheets/d/${ID}`,
      `https://drive.google.com/file/d/${ID}/view`,
      'https://docs.google.com/spreadsheets/d/short/edit',
      'javascript:alert(1)',
      '',
    ])
      expect(parseSheetLink(link)).toBeNull();
  });

  it('builds the download address itself', () => {
    expect(exportUrl({ kind: 'doc', id: ID })).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`,
    );
    expect(exportUrl({ kind: 'published', id: 'X' })).toBe(
      'https://docs.google.com/spreadsheets/d/e/X/pub?output=xlsx',
    );
  });

  it('takes the title from the download, cleaned', () => {
    expect(
      titleFrom(`attachment; filename="a.xlsx"; filename*=UTF-8''Stock%20%26%20sales.xlsx`),
    ).toBe('Stock & sales');
    expect(titleFrom('attachment; filename="../../etc/passwd.xlsx"')).toBe('.. .. etc passwd');
    expect(titleFrom(null)).toBeNull();
  });
});

describe('safeFetch', () => {
  afterEach(() => setConnectorFetch(null));
  const allowHost = (h: string) => h === 'docs.google.com' || h.endsWith('.googleusercontent.com');

  it('follows redirects only to allowed https hosts', async () => {
    setConnectorFetch(async (url) =>
      url.startsWith('https://docs.google.com')
        ? new Response(null, {
            status: 307,
            headers: { location: 'https://doc-0.googleusercontent.com/export/x' },
          })
        : new Response('ok', { status: 200 }),
    );
    const r = await safeFetch('https://docs.google.com/x', { allowHost, maxBytes: 100 });
    expect(r.url).toBe('https://doc-0.googleusercontent.com/export/x');
    expect(new TextDecoder().decode(r.bytes)).toBe('ok');

    for (const location of ['http://doc-0.googleusercontent.com/x', 'https://169.254.169.254/']) {
      setConnectorFetch(async () => new Response(null, { status: 302, headers: { location } }));
      await expect(
        safeFetch('https://docs.google.com/x', { allowHost, maxBytes: 100 }),
      ).rejects.toBeInstanceOf(SourceError);
    }
  });

  it('stops at the size limit and at redirect loops', async () => {
    setConnectorFetch(async () => new Response('x'.repeat(200), { status: 200 }));
    await expect(
      safeFetch('https://docs.google.com/x', { allowHost, maxBytes: 100 }),
    ).rejects.toThrow(/larger than/);
    setConnectorFetch(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://docs.google.com/again' } }),
    );
    await expect(
      safeFetch('https://docs.google.com/x', { allowHost, maxBytes: 100 }),
    ).rejects.toThrow(SourceError);
  });
});

describe('settledByMapping', () => {
  const q = (effects: unknown[]) =>
    ({
      id: 'q',
      text: 't',
      about: 'a',
      defaultOption: 'a',
      options: effects.map((effect, i) => ({ id: String(i), label: 'x', effect })),
    }) as Parameters<typeof settledByMapping>[0];
  const known = new Set(['f0:Orders']);

  it('treats questions about a recognised sheet as settled', () => {
    expect(
      settledByMapping(
        q([{ kind: 'set_date_order', sourceIds: ['f0:Orders'], order: 'DMY' }, { kind: 'none' }]),
        known,
      ),
    ).toBe(true);
  });

  it('keeps asking about new sheets and about names', () => {
    expect(
      settledByMapping(q([{ kind: 'ignore_source', sourceId: 'f1:New' }, { kind: 'none' }]), known),
    ).toBe(false);
    expect(
      settledByMapping(
        q([
          { kind: 'keep_dedupe', entity: 'customer', canonical: 'Bloom & Co' },
          { kind: 'drop_dedupe', entity: 'customer', canonical: 'Bloom & Co' },
        ]),
        known,
      ),
    ).toBe(false);
  });
});
