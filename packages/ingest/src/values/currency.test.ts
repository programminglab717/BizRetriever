import { describe, expect, it } from 'vitest';

import { cellCurrency, currencyColumn, headerCurrency, toCurrencyCode } from './currency';

describe('currency codes', () => {
  it('reads codes and symbols, with "$" as the business’s own dollar when it has one', () => {
    expect(toCurrencyCode('EUR', 'USD')).toBe('EUR');
    expect(toCurrencyCode('eur', 'USD')).toBe('EUR');
    expect(toCurrencyCode('€', 'USD')).toBe('EUR');
    expect(toCurrencyCode('£', 'USD')).toBe('GBP');
    expect(toCurrencyCode('$', 'USD')).toBe('USD');
    expect(toCurrencyCode('$', 'CAD')).toBe('CAD');
    expect(toCurrencyCode('$', 'EUR')).toBe('USD');
    expect(toCurrencyCode('A$', 'USD')).toBe('AUD');
    expect(toCurrencyCode('¥', 'USD')).toBe('JPY');
    expect(toCurrencyCode('¥', 'CNY')).toBe('CNY');
    expect(toCurrencyCode('Rs', 'PKR')).toBe('PKR');
    expect(toCurrencyCode('Rs', 'USD')).toBe('INR');
    expect(toCurrencyCode('XYZ', 'USD')).toBeNull();
    expect(toCurrencyCode('', 'USD')).toBeNull();
  });

  it('finds a currency in a column header', () => {
    expect(headerCurrency('Price (EUR)', 'USD')).toBe('EUR');
    expect(headerCurrency('Line total (USD)', 'USD')).toBe('USD');
    expect(headerCurrency('Amount €', 'USD')).toBe('EUR');
    expect(headerCurrency('Total GBP', 'USD')).toBe('GBP');
    expect(headerCurrency('Price', 'USD')).toBeNull();
    // Words that only contain a code aren't one.
    expect(headerCurrency('Euro Pallets', 'USD')).toBeNull();
    expect(headerCurrency('USDA grade', 'USD')).toBeNull();
  });

  it('finds a currency written in a value', () => {
    expect(cellCurrency('€12.50', 'USD')).toBe('EUR');
    expect(cellCurrency('12.50 GBP', 'USD')).toBe('GBP');
    expect(cellCurrency('$12.50', 'GBP')).toBe('USD');
    expect(cellCurrency('12.50', 'USD')).toBeNull();
    expect(cellCurrency(12.5, 'USD')).toBeNull();
  });

  it('knows a Currency column when it sees one', () => {
    for (const h of ['Currency', 'currency code', 'Curr', 'CCY', 'Moneda', 'Devise', 'Währung'])
      expect(currencyColumn(h), h).toBe(true);
    for (const h of ['Currency rate', 'Price', 'Exchange rate'])
      expect(currencyColumn(h), h).toBe(false);
  });
});
