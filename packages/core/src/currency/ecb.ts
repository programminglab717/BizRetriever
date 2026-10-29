import { safeFetch } from '../connections/fetch';

/**
 * The European Central Bank's euro reference rates (M20, ADR-070): free, no key, published around
 * 16:00 CET on working days for about 30 currencies. We read the XML files it has published in the
 * same format since 1999.
 */

const HOST = 'www.ecb.europa.eu';
export const ECB_RECENT_URL = `https://${HOST}/stats/eurofxref/eurofxref-hist-90d.xml`;
export const ECB_HISTORY_URL = `https://${HOST}/stats/eurofxref/eurofxref-hist.xml`;

export interface EcbRate {
  day: string;
  currency: string;
  perEur: string;
}

/** `<Cube time="2026-10-23"><Cube currency="USD" rate="1.0812"/>…</Cube>` → rows. */
export function parseEcbXml(xml: string): EcbRate[] {
  const out: EcbRate[] = [];
  let day: string | null = null;
  const tag =
    /<Cube\s+(?:time=['"](\d{4}-\d{2}-\d{2})['"]|currency=['"]([A-Z]{3})['"]\s+rate=['"](\d+(?:\.\d+)?)['"])/g;
  for (const m of xml.matchAll(tag)) {
    if (m[1]) day = m[1];
    else if (day && m[2] && m[3] && Number(m[3]) > 0) {
      out.push({ day, currency: m[2], perEur: m[3] });
    }
  }
  return out;
}

/** Fetches the last 90 days, or (`history`) every day since 1999. */
export async function fetchEcbRates(history = false): Promise<EcbRate[]> {
  const res = await safeFetch(history ? ECB_HISTORY_URL : ECB_RECENT_URL, {
    allowHost: (h) => h === HOST,
    maxBytes: 40 * 1024 * 1024,
    timeoutMs: 60_000,
    headers: { accept: 'application/xml, text/xml' },
  });
  if (res.status !== 200) throw new Error(`ECB rates: HTTP ${res.status}`);
  const rows = parseEcbXml(new TextDecoder().decode(res.bytes));
  if (rows.length === 0) throw new Error('ECB rates: no rates in the file');
  return rows;
}
