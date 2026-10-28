import { getEnv } from '@bizr/platform';

import { SourceError } from './fetch';
import { apiJson, tokenRequest, tokensOnly } from './oauth/http';
import type { Connection, OAuthProvider, OAuthTokens } from './oauth/provider';
import { callbackUrl } from './oauth/service';
import { connectorSecretsEnabled } from './secret';
import {
  accountingSheets,
  decimal,
  keepsPayments,
  textOf,
  workbookFile,
  type AccountCustomer,
  type AccountItem,
  type InvoiceLine,
  type PaymentRow,
} from './workbook';

/**
 * QuickBooks Online (M18, ADR-068): invoices, customers, payments and products read through the
 * Accounting API's query endpoint, a thousand at a time. Access tokens last an hour; refresh tokens
 * rotate, so the new one is stored before anything else. `minorversion=75` is the lowest Intuit
 * still serves (lower ones are answered as 75 since August 2025).
 */

const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '75';
const PAGE = 1000;
const MAX_PAGES = 50;
export const QBO_FIRST_DAYS = 365;

const apiBase = () =>
  getEnv().QUICKBOOKS_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

function app() {
  const env = getEnv();
  if (!env.QUICKBOOKS_CLIENT_ID || !env.QUICKBOOKS_CLIENT_SECRET)
    throw new Error('QuickBooks app keys are not set');
  return { id: env.QUICKBOOKS_CLIENT_ID, secret: env.QUICKBOOKS_CLIENT_SECRET };
}

const REALM = /^\d{1,20}$/;

interface Ref {
  value?: string;
  name?: string;
}
interface QboInvoice {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  Balance?: number;
  TotalAmt?: number;
  CustomerRef?: Ref;
  CurrencyRef?: Ref;
  Line?: {
    Amount?: number;
    Description?: string;
    DetailType?: string;
    SalesItemLineDetail?: { ItemRef?: Ref; Qty?: number; UnitPrice?: number };
  }[];
}
interface QboCustomer {
  DisplayName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  BillAddr?: { City?: string };
  SalesTermRef?: Ref;
  Active?: boolean;
}
interface QboItem {
  Id?: string;
  Name?: string;
  Sku?: string;
  Type?: string;
  UnitPrice?: number;
  PurchaseCost?: number;
  TrackQtyOnHand?: boolean;
  QtyOnHand?: number;
  Active?: boolean;
}
interface QboPayment {
  TxnDate?: string;
  TotalAmt?: number;
  PaymentRefNum?: string;
  CustomerRef?: Ref;
  PaymentMethodRef?: Ref;
  Line?: { Amount?: number; LinkedTxn?: { TxnId?: string; TxnType?: string }[] }[];
}

async function query<T>(realm: string, token: string, entity: string, where = ''): Promise<T[]> {
  if (!REALM.test(realm))
    throw new SourceError('That QuickBooks company can’t be read.', 'needs_attention');
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const q = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ''} STARTPOSITION ${page * PAGE + 1} MAXRESULTS ${PAGE}`;
    const url = new URL(`${apiBase()}/v3/company/${realm}/query`);
    url.searchParams.set('query', q);
    url.searchParams.set('minorversion', MINOR_VERSION);
    const body = await apiJson<{ QueryResponse?: Record<string, unknown> }>(
      'QuickBooks',
      url.toString(),
      {
        token,
      },
    );
    const rows = body.QueryResponse?.[entity];
    const list = Array.isArray(rows) ? (rows as T[]) : [];
    out.push(...list);
    if (list.length < PAGE) break;
  }
  return out;
}

const day = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

export const quickbooks: OAuthProvider = {
  kind: 'quickbooks',
  label: 'QuickBooks',
  enabled() {
    const env = getEnv();
    return Boolean(
      env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET && connectorSecretsEnabled(),
    );
  },
  authorizeUrl(state) {
    const url = new URL(AUTHORIZE);
    url.searchParams.set('client_id', app().id);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    url.searchParams.set('redirect_uri', callbackUrl('quickbooks'));
    url.searchParams.set('state', state);
    return url.toString();
  },
  async connect(params, now) {
    const realm = params.get('realmId') ?? '';
    if (!REALM.test(realm))
      throw new SourceError('QuickBooks didn’t say which company to read. Please try again.');
    const tokens = await tokenRequest({
      label: 'QuickBooks',
      url: TOKEN,
      basic: app(),
      form: {
        grant_type: 'authorization_code',
        code: params.get('code') ?? '',
        redirect_uri: callbackUrl('quickbooks'),
      },
      now,
    });
    const info = await apiJson<{ CompanyInfo?: { CompanyName?: string } }>(
      'QuickBooks',
      `${apiBase()}/v3/company/${realm}/companyinfo/${realm}?minorversion=${MINOR_VERSION}`,
      { token: tokens.accessToken },
    );
    return {
      tokens: tokensOnly(tokens),
      account: { externalId: realm, name: textOf(info.CompanyInfo?.CompanyName) ?? 'QuickBooks' },
    };
  },
  async refresh(tokens, now): Promise<OAuthTokens> {
    const fresh = await tokenRequest({
      label: 'QuickBooks',
      url: TOKEN,
      basic: app(),
      form: { grant_type: 'refresh_token', refresh_token: tokens.refreshToken ?? '' },
      now,
    });
    // Refresh tokens rotate: the answer carries the one to keep.
    return tokensOnly({ ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken });
  },
  async read(c, token, now) {
    return readQuickBooks(c, token, now);
  },
  link: () => 'https://qbo.intuit.com/app/homepage',
};

export async function readQuickBooks(c: Connection, token: string, now = new Date()) {
  const realm = c.externalId;
  const since = typeof c.config.checkedAt === 'string' ? c.config.checkedAt : null;
  // Changed since a day before the last check, or the last year the first time.
  const changed = since
    ? `Metadata.LastUpdatedTime >= '${new Date(Date.parse(since) - 86_400_000).toISOString()}'`
    : `TxnDate >= '${new Date(now.getTime() - QBO_FIRST_DAYS * 86_400_000).toISOString().slice(0, 10)}'`;
  const [items, customers, invoices, payments] = await Promise.all([
    query<QboItem>(realm, token, 'Item'),
    query<QboCustomer>(realm, token, 'Customer'),
    query<QboInvoice>(realm, token, 'Invoice', changed),
    keepsPayments(c.workspaceId).then((keep) =>
      keep ? query<QboPayment>(realm, token, 'Payment', changed) : null,
    ),
  ]);
  const byId = new Map(items.map((i) => [i.Id, i]));
  const docOf = new Map(invoices.map((i) => [i.Id, i.DocNumber ?? i.Id ?? null]));
  // Payments for invoices older than this fetch: look their numbers up, 100 at a time.
  const missing = [
    ...new Set(
      (payments ?? []).flatMap((p) =>
        (p.Line ?? []).flatMap((l) =>
          (l.LinkedTxn ?? [])
            .filter((t) => t.TxnType === 'Invoice' && t.TxnId && !docOf.has(t.TxnId))
            .map((t) => t.TxnId!),
        ),
      ),
    ),
  ].filter((id) => /^\d{1,20}$/.test(id));
  for (let i = 0; i < missing.length; i += 100) {
    const ids = missing
      .slice(i, i + 100)
      .map((id) => `'${id}'`)
      .join(', ');
    for (const inv of await query<QboInvoice>(realm, token, 'Invoice', `Id IN (${ids})`))
      docOf.set(inv.Id, inv.DocNumber ?? inv.Id ?? null);
  }
  const lines: InvoiceLine[] = [];
  let currency: string | null = null;
  for (const inv of invoices) {
    currency ??= textOf(inv.CurrencyRef?.value);
    for (const l of inv.Line ?? []) {
      if (l.DetailType !== 'SalesItemLineDetail') continue;
      const d = l.SalesItemLineDetail ?? {};
      const item = byId.get(d.ItemRef?.value);
      lines.push({
        invoice: textOf(inv.DocNumber) ?? textOf(inv.Id) ?? '',
        date: day(inv.TxnDate),
        customer: textOf(inv.CustomerRef?.name),
        itemCode: textOf(item?.Sku) ?? textOf(item?.Name) ?? textOf(d.ItemRef?.name),
        description: textOf(l.Description) ?? textOf(item?.Name) ?? textOf(d.ItemRef?.name),
        quantity: typeof d.Qty === 'number' ? d.Qty : null,
        unitPrice: decimal(d.UnitPrice),
        lineTotal: decimal(l.Amount),
        due: day(inv.DueDate),
        // Overdue is worked out from the due date, so the file only changes when the invoice does.
        status: inv.Balance === 0 ? 'Paid' : 'Unpaid',
      });
    }
  }
  const accounts: AccountCustomer[] = customers
    .filter((c) => c.Active !== false && textOf(c.DisplayName))
    .map((c) => ({
      name: textOf(c.DisplayName)!,
      email: textOf(c.PrimaryEmailAddr?.Address),
      phone: textOf(c.PrimaryPhone?.FreeFormNumber),
      city: textOf(c.BillAddr?.City),
      terms: textOf(c.SalesTermRef?.name),
    }));
  const products: AccountItem[] = items
    .filter(
      (i) => ['Inventory', 'NonInventory', 'Service'].includes(i.Type ?? '') && textOf(i.Name),
    )
    .map((i) => ({
      code: textOf(i.Sku) ?? textOf(i.Name),
      name: textOf(i.Name)!,
      cost: decimal(i.PurchaseCost),
      price: decimal(i.UnitPrice),
      inStock: i.TrackQtyOnHand && typeof i.QtyOnHand === 'number' ? i.QtyOnHand : null,
    }));
  const paid: PaymentRow[] = [];
  for (const p of payments ?? [])
    for (const l of p.Line ?? [])
      for (const t of l.LinkedTxn ?? [])
        if (t.TxnType === 'Invoice')
          paid.push({
            date: day(p.TxnDate),
            customer: textOf(p.CustomerRef?.name),
            invoice: docOf.get(t.TxnId) ?? textOf(t.TxnId),
            amount: decimal(l.Amount),
            method: textOf(p.PaymentMethodRef?.name),
            ref: textOf(p.PaymentRefNum),
          });
  return {
    name: c.name,
    files: [
      await workbookFile(
        'QuickBooks.xlsx',
        accountingSheets(
          { invoices: lines, customers: accounts, payments: paid, items: products },
          currency,
          { payments: payments !== null },
        ),
      ),
    ],
    config: { checkedAt: now.toISOString() },
  };
}
