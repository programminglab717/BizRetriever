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
 * Xero (M18, ADR-068): sales invoices, customers, payments and items from one organisation, read
 * with the granular read-only scopes Xero requires of apps made since March 2026. Access tokens
 * last 30 minutes and refresh tokens rotate. Every call names the organisation (`xero-tenant-id`).
 * The free plan allows a few connected organisations and about a thousand calls a day each; a
 * daily check uses a handful.
 */

const AUTHORIZE = 'https://login.xero.com/identity/connect/authorize';
const TOKEN = 'https://identity.xero.com/connect/token';
const CONNECTIONS = 'https://api.xero.com/connections';
const API = 'https://api.xero.com/api.xro/2.0';
export const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.invoices.read',
  'accounting.payments.read',
  'accounting.contacts.read',
  'accounting.settings.read',
];
const PAGE = 1000;
const MAX_PAGES = 50;
export const XERO_FIRST_DAYS = 365;

function app() {
  const env = getEnv();
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) throw new Error('Xero app keys are not set');
  return { id: env.XERO_CLIENT_ID, secret: env.XERO_CLIENT_SECRET };
}

const TENANT = /^[0-9a-f-]{36}$/i;

interface XeroInvoice {
  Type?: string;
  InvoiceNumber?: string;
  Contact?: { Name?: string };
  DateString?: string;
  Date?: string;
  DueDateString?: string;
  DueDate?: string;
  Status?: string;
  AmountDue?: number;
  CurrencyCode?: string;
  LineItems?: {
    ItemCode?: string;
    Description?: string;
    Quantity?: number;
    UnitAmount?: number;
    LineAmount?: number;
  }[];
}
interface XeroContact {
  Name?: string;
  EmailAddress?: string;
  IsCustomer?: boolean;
  ContactStatus?: string;
  Phones?: { PhoneType?: string; PhoneNumber?: string; PhoneAreaCode?: string }[];
  Addresses?: { AddressType?: string; City?: string }[];
  PaymentTerms?: { Sales?: { Day?: number; Type?: string } };
}
interface XeroItem {
  Code?: string;
  Name?: string;
  IsTrackedAsInventory?: boolean;
  QuantityOnHand?: number;
  PurchaseDetails?: { UnitPrice?: number };
  SalesDetails?: { UnitPrice?: number };
}
interface XeroPayment {
  Date?: string;
  Amount?: number;
  Reference?: string;
  Status?: string;
  PaymentType?: string;
  Invoice?: { InvoiceNumber?: string; Contact?: { Name?: string } };
}

/** "2026-10-01T00:00:00" or "/Date(1793232000000+0000)/" → "2026-10-01". */
export function xeroDay(s?: string, raw?: string): string | null {
  if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ms = /\/Date\((-?\d+)/.exec(raw ?? '')?.[1];
  return ms ? new Date(Number(ms)).toISOString().slice(0, 10) : null;
}

async function pages<T>(
  token: string,
  tenant: string,
  path: string,
  key: string,
  query: Record<string, string>,
  modifiedSince: string | null,
): Promise<T[]> {
  if (!TENANT.test(tenant))
    throw new SourceError('That Xero organisation can’t be read.', 'needs_attention');
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries({ ...query, page: String(page), pageSize: String(PAGE) }))
      url.searchParams.set(k, v);
    const body = await apiJson<Record<string, unknown>>('Xero', url.toString(), {
      token,
      headers: {
        'xero-tenant-id': tenant,
        ...(modifiedSince ? { 'if-modified-since': modifiedSince } : {}),
      },
    });
    const rows = Array.isArray(body[key]) ? (body[key] as T[]) : [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const terms = (t: XeroContact['PaymentTerms']) => {
  const s = t?.Sales;
  if (!s?.Day || !s.Type) return null;
  if (s.Type === 'DAYSAFTERBILLDATE') return `Net ${s.Day}`;
  if (s.Type === 'OFFOLLOWINGMONTH') return `${s.Day} of the following month`;
  return null;
};

export const xero: OAuthProvider = {
  kind: 'xero',
  label: 'Xero',
  enabled() {
    const env = getEnv();
    return Boolean(env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET && connectorSecretsEnabled());
  },
  authorizeUrl(state) {
    const url = new URL(AUTHORIZE);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app().id);
    url.searchParams.set('redirect_uri', callbackUrl('xero'));
    url.searchParams.set('scope', XERO_SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },
  async connect(params, now) {
    const tokens = await tokenRequest({
      label: 'Xero',
      url: TOKEN,
      basic: app(),
      form: {
        grant_type: 'authorization_code',
        code: params.get('code') ?? '',
        redirect_uri: callbackUrl('xero'),
      },
      now,
    });
    const orgs = await apiJson<
      { tenantId?: string; tenantType?: string; tenantName?: string; createdDateUtc?: string }[]
    >('Xero', CONNECTIONS, { token: tokens.accessToken });
    // The organisation just approved is the newest connection.
    const org = (Array.isArray(orgs) ? orgs : [])
      .filter((o) => o.tenantType === 'ORGANISATION' && TENANT.test(o.tenantId ?? ''))
      .sort((a, b) => (b.createdDateUtc ?? '').localeCompare(a.createdDateUtc ?? ''))[0];
    if (!org)
      throw new SourceError('Xero didn’t give us an organisation to read. Please try again.');
    return {
      tokens: tokensOnly(tokens),
      account: { externalId: org.tenantId!.toLowerCase(), name: textOf(org.tenantName) ?? 'Xero' },
    };
  },
  async refresh(tokens, now): Promise<OAuthTokens> {
    const fresh = await tokenRequest({
      label: 'Xero',
      url: TOKEN,
      basic: app(),
      form: { grant_type: 'refresh_token', refresh_token: tokens.refreshToken ?? '' },
      now,
    });
    return tokensOnly({ ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken });
  },
  read: (c, token, now) => readXero(c, token, now),
  link: () => 'https://go.xero.com/',
};

export async function readXero(c: Connection, token: string, now = new Date()) {
  const tenant = c.externalId;
  const since = typeof c.config.checkedAt === 'string' ? c.config.checkedAt : null;
  const modified = since
    ? new Date(Date.parse(since) - 86_400_000).toISOString().slice(0, 19)
    : null;
  const first = new Date(now.getTime() - XERO_FIRST_DAYS * 86_400_000);
  const dateWhere = `Date>=DateTime(${first.getUTCFullYear()},${first.getUTCMonth() + 1},${first.getUTCDate()})`;
  const keep = await keepsPayments(c.workspaceId);
  // One after another: Xero allows a few calls at a time per organisation.
  const items = await apiJson<{ Items?: XeroItem[] }>('Xero', `${API}/Items?unitdp=4`, {
    token,
    headers: { 'xero-tenant-id': tenant },
  });
  const contacts = await pages<XeroContact>(
    token,
    tenant,
    'Contacts',
    'Contacts',
    { where: 'IsCustomer==true' },
    null,
  );
  const invoices = await pages<XeroInvoice>(
    token,
    tenant,
    'Invoices',
    'Invoices',
    {
      where: since ? 'Type=="ACCREC"' : `Type=="ACCREC" AND ${dateWhere}`,
      Statuses: 'AUTHORISED,PAID',
      unitdp: '4',
    },
    modified,
  );
  const payments = keep
    ? await pages<XeroPayment>(
        token,
        tenant,
        'Payments',
        'Payments',
        {
          where: since
            ? 'PaymentType=="ACCRECPAYMENT"'
            : `PaymentType=="ACCRECPAYMENT" AND ${dateWhere}`,
        },
        modified,
      )
    : null;
  const lines: InvoiceLine[] = [];
  let currency: string | null = null;
  for (const inv of invoices) {
    if (inv.Type !== 'ACCREC') continue;
    currency ??= textOf(inv.CurrencyCode);
    for (const l of inv.LineItems ?? [])
      lines.push({
        invoice: textOf(inv.InvoiceNumber) ?? '',
        date: xeroDay(inv.DateString, inv.Date),
        customer: textOf(inv.Contact?.Name),
        itemCode: textOf(l.ItemCode),
        description: textOf(l.Description),
        quantity: typeof l.Quantity === 'number' ? l.Quantity : null,
        unitPrice: decimal(l.UnitAmount),
        lineTotal: decimal(l.LineAmount),
        due: xeroDay(inv.DueDateString, inv.DueDate),
        status: inv.Status === 'PAID' || inv.AmountDue === 0 ? 'Paid' : 'Unpaid',
      });
  }
  const accounts: AccountCustomer[] = contacts
    .filter((x) => x.ContactStatus !== 'ARCHIVED' && textOf(x.Name))
    .map((x) => {
      const phone = x.Phones?.find((p) => p.PhoneType === 'DEFAULT' && p.PhoneNumber);
      return {
        name: textOf(x.Name)!,
        email: textOf(x.EmailAddress),
        phone: phone ? [phone.PhoneAreaCode, phone.PhoneNumber].filter(Boolean).join(' ') : null,
        city: textOf(x.Addresses?.find((a) => a.AddressType === 'STREET')?.City),
        terms: terms(x.PaymentTerms),
      };
    });
  const products: AccountItem[] = (items.Items ?? [])
    .filter((i) => textOf(i.Name) || textOf(i.Code))
    .map((i) => ({
      code: textOf(i.Code),
      name: textOf(i.Name) ?? textOf(i.Code)!,
      cost: decimal(i.PurchaseDetails?.UnitPrice),
      price: decimal(i.SalesDetails?.UnitPrice),
      inStock:
        i.IsTrackedAsInventory && typeof i.QuantityOnHand === 'number' ? i.QuantityOnHand : null,
    }));
  const paid: PaymentRow[] = (payments ?? [])
    .filter((p) => p.Status !== 'DELETED')
    .map((p) => ({
      date: xeroDay(undefined, p.Date) ?? xeroDay(p.Date),
      customer: textOf(p.Invoice?.Contact?.Name),
      invoice: textOf(p.Invoice?.InvoiceNumber),
      amount: decimal(p.Amount),
      method: null,
      ref: textOf(p.Reference),
    }));
  return {
    name: c.name,
    files: [
      await workbookFile(
        'Xero.xlsx',
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
