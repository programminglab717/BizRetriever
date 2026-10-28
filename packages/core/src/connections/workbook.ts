import { getAppDb, workspace } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { eq } from 'drizzle-orm';

import type { Sheet, SheetCell } from '../export/sheet';
import { toXlsx } from '../export/write';

/**
 * The workbooks linked sources become (M10, M18). Every shop source (Shopify, Square, WooCommerce)
 * writes the same Products, Customers and Orders tabs, and every accounting source (QuickBooks,
 * Xero) the same Invoices, Customers, Payments and Products tabs, so the import recognises them by
 * their headers without AI, and a later update matches the first.
 */

export interface ShopProduct {
  name: string;
  sku: string | null;
  category: string | null;
  supplier: string | null;
  price: string | null;
  cost: string | null;
  inStock: number | null;
  active: boolean;
}

export interface ShopCustomer {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** YYYY-MM-DD */
  since: string | null;
}

export interface ShopOrderLine {
  order: string;
  /** "YYYY-MM-DD HH:MM:SS", UTC */
  date: string | null;
  status: 'completed' | 'cancelled' | 'refunded' | 'partially refunded' | 'pending';
  customer: string | null;
  email: string | null;
  sku: string | null;
  item: string | null;
  quantity: number | null;
  unitPrice: string | null;
  lineTotal: string | null;
  channel: string;
}

const priced = (label: string, currency: string | null) =>
  currency ? `${label} (${currency})` : label;

export function shopSheets(
  data: { products: ShopProduct[]; customers: ShopCustomer[]; orders: ShopOrderLine[] },
  currency: string | null,
): Sheet[] {
  const m = (label: string) => priced(label, currency);
  return [
    {
      name: 'Products',
      columns: [
        { label: 'Product', type: 'text' },
        { label: 'SKU', type: 'text' },
        { label: 'Category', type: 'text' },
        { label: 'Supplier', type: 'text' },
        { label: m('Price'), type: 'money' },
        { label: m('Cost'), type: 'money' },
        { label: 'In stock', type: 'number' },
        { label: 'Status', type: 'text' },
      ],
      rows: data.products.map((p): SheetCell[] => [
        p.name,
        p.sku,
        p.category,
        p.supplier,
        p.price,
        p.cost,
        p.inStock,
        p.active ? 'active' : 'inactive',
      ]),
    },
    {
      name: 'Customers',
      columns: [
        { label: 'Customer', type: 'text' },
        { label: 'Email', type: 'text' },
        { label: 'Phone', type: 'text' },
        { label: 'Customer since', type: 'date' },
      ],
      rows: data.customers.map((c): SheetCell[] => [c.name, c.email, c.phone, c.since]),
    },
    {
      name: 'Orders',
      columns: [
        { label: 'Order', type: 'text' },
        { label: 'Date (UTC)', type: 'datetime' },
        { label: 'Status', type: 'text' },
        { label: 'Customer', type: 'text' },
        { label: 'Email', type: 'text' },
        { label: 'SKU', type: 'text' },
        { label: 'Item', type: 'text' },
        { label: 'Quantity', type: 'number' },
        { label: m('Unit price'), type: 'money' },
        { label: m('Line total'), type: 'money' },
        { label: 'Channel', type: 'text' },
      ],
      rows: data.orders.map((o): SheetCell[] => [
        o.order,
        o.date,
        o.status,
        o.customer,
        o.email,
        o.sku,
        o.item,
        o.quantity,
        o.unitPrice,
        o.lineTotal,
        o.channel,
      ]),
    },
  ];
}

export interface InvoiceLine {
  invoice: string;
  /** YYYY-MM-DD */
  date: string | null;
  customer: string | null;
  itemCode: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: string | null;
  lineTotal: string | null;
  due: string | null;
  status: 'Paid' | 'Unpaid' | 'Overdue' | 'Void';
}

export interface AccountCustomer {
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  terms: string | null;
}

export interface PaymentRow {
  date: string | null;
  customer: string | null;
  invoice: string | null;
  amount: string | null;
  method: string | null;
  ref: string | null;
}

export interface AccountItem {
  code: string | null;
  name: string;
  cost: string | null;
  price: string | null;
  inStock: number | null;
}

/** Same headers as the invoice-based files owners download from their accounting tools. */
export function accountingSheets(
  data: {
    invoices: InvoiceLine[];
    customers: AccountCustomer[];
    payments: PaymentRow[];
    items: AccountItem[];
  },
  currency: string | null,
  options: { payments: boolean } = { payments: true },
): Sheet[] {
  const m = (label: string) => priced(label, currency);
  const sheets: Sheet[] = [
    {
      name: 'Invoices',
      columns: [
        { label: 'Invoice No', type: 'text' },
        { label: 'Invoice Date', type: 'date' },
        { label: 'Customer', type: 'text' },
        { label: 'Item Code', type: 'text' },
        { label: 'Description', type: 'text' },
        { label: 'Qty', type: 'number' },
        { label: m('Unit Price'), type: 'money' },
        { label: m('Line Total'), type: 'money' },
        { label: 'Due Date', type: 'date' },
        { label: 'Status', type: 'text' },
      ],
      rows: data.invoices.map((i): SheetCell[] => [
        i.invoice,
        i.date,
        i.customer,
        i.itemCode,
        i.description,
        i.quantity,
        i.unitPrice,
        i.lineTotal,
        i.due,
        i.status,
      ]),
    },
    {
      name: 'Customers',
      columns: [
        { label: 'Customer', type: 'text' },
        { label: 'Email', type: 'text' },
        { label: 'Phone', type: 'text' },
        { label: 'City', type: 'text' },
        { label: 'Terms', type: 'text' },
      ],
      rows: data.customers.map((c): SheetCell[] => [c.name, c.email, c.phone, c.city, c.terms]),
    },
    {
      name: 'Payments',
      columns: [
        { label: 'Date', type: 'date' },
        { label: 'Customer', type: 'text' },
        { label: 'Invoice', type: 'text' },
        { label: m('Amount'), type: 'money' },
        { label: 'Method', type: 'text' },
        { label: 'Ref', type: 'text' },
      ],
      rows: data.payments.map((p): SheetCell[] => [
        p.date,
        p.customer,
        p.invoice,
        p.amount,
        p.method,
        p.ref,
      ]),
    },
    {
      name: 'Products',
      columns: [
        { label: 'Code', type: 'text' },
        { label: 'Product', type: 'text' },
        { label: m('Cost'), type: 'money' },
        { label: m('Price'), type: 'money' },
        { label: 'In Stock', type: 'number' },
      ],
      rows: data.items.map((i): SheetCell[] => [i.code, i.name, i.cost, i.price, i.inStock]),
    },
  ];
  return options.payments ? sheets : sheets.filter((s) => s.name !== 'Payments');
}

/** "18.5" → "18.5"; anything not a plain decimal → null. Money stays a string. */
export const decimal = (v: unknown): string | null => {
  const s = typeof v === 'number' ? String(v) : v;
  return typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s.trim()) ? s.trim() : null;
};

/** Smallest currency unit (cents) → a decimal string, for currencies with two decimals. */
export const fromMinor = (v: unknown, places = 2): string | null => {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = typeof v === 'number' ? BigInt(Math.trunc(v)) : /^-?\d+$/.test(v) ? BigInt(v) : null;
  if (n === null) return null;
  if (places === 0) return n.toString();
  const neg = n < 0n;
  const abs = (neg ? -n : n).toString().padStart(places + 1, '0');
  return `${neg ? '-' : ''}${abs.slice(0, -places)}.${abs.slice(-places)}`;
};

export const textOf = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** ISO date-time → "YYYY-MM-DD HH:MM:SS" (UTC). */
export const utcStamp = (iso: unknown): string | null => {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 19).replace('T', ' ');
};

/** The workbook as the one file a linked source hands the import. */
export async function workbookFile(
  fileName: string,
  sheets: Sheet[],
): Promise<{ fileName: string; mime: string; bytes: Uint8Array }> {
  return {
    fileName,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: await toXlsx(sheets),
  };
}

/**
 * Whether the business's industry keeps payments as their own records (wholesale does, retail
 * doesn't). Without them, a Payments tab would be read as invoice totals, which is wrong for part
 * payments, so accounting sources leave it out.
 */
export async function keepsPayments(workspaceId: string): Promise<boolean> {
  const [ws] = await getAppDb()
    .select({ packId: workspace.packId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  return Boolean(ws && getPack(ws.packId).entities.some((e) => e.id === 'payment'));
}
