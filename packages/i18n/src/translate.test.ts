import { describe, expect, it } from 'vitest';

import { makeTranslator, pickLanguage } from './translate';

const catalog = {
  Saved: 'Guardado',
  'Order total': 'Total del pedido',
  '{n} records': '{n} registros',
  '1 record': '1 registro',
  '{label}: no published exchange rate for {currency} on {day}, so it was left empty':
    '{label}: no hay tipo de cambio publicado para {currency} el {day}, así que quedó vacío',
  'Hello {name}.': 'Hola, {name}.',
  'Welcome back.': 'Bienvenido de nuevo.',
  Products: 'Productos',
  Brand: 'Marca',
  Category: 'Categoría',
  'Add {what} to {where}.': 'Añade {what} a {where}.',
  'Undid: {change}': 'Deshecho: {change}',
  'Remove “{title}”': 'Quitar “{title}”',
};

describe('translator', () => {
  const t = makeTranslator('es', catalog);
  const en = makeTranslator('en', catalog);

  it('looks up English text and fills placeholders', () => {
    expect(t('Saved')).toBe('Guardado');
    expect(t('{n} records', { n: 1200 })).toBe('1,200 registros');
    expect(t('Not in the catalog {x}', { x: 'yet' })).toBe('Not in the catalog yet');
    expect(en('Saved')).toBe('Saved');
    expect(t.lang).toBe('es');
  });

  it('picks the singular or plural form', () => {
    expect(t.plural(1, '1 record', '{n} records')).toBe('1 registro');
    expect(t.plural(3, '1 record', '{n} records')).toBe('3 registros');
  });

  it('translates stored English text by matching templates', () => {
    expect(
      t.text('Order total: no published exchange rate for AED on 2026-03-02, so it was left empty'),
    ).toBe(
      'Total del pedido: no hay tipo de cambio publicado para AED el 2026-03-02, así que quedó vacío',
    );
    expect(t.text('12 records')).toBe('12 registros');
    expect(t.text('Hello Ana. Welcome back.')).toBe('Hola, Ana. Bienvenido de nuevo.');
    expect(t.text('Something we never wrote')).toBe('Something we never wrote');
    expect(en.text('12 records')).toBe('12 records');
  });

  it('translates the values a template captures', () => {
    // Labels in lower case inside a sentence, counts, lists, and templates inside templates.
    expect(t.text('Add brand to products.')).toBe('Añade marca a productos.');
    expect(t.text('Add brand and category to 12 products.')).toBe(
      'Añade marca y categoría a 12 productos.',
    );
    expect(t.text('Undid: Remove “Sales”')).toBe('Deshecho: Quitar “Sales”');
    expect(t.text('Add Sage Mug to Products.')).toBe('Añade Sage Mug a Productos.');
  });
});

describe('pickLanguage', () => {
  it('takes the first language we have, by preference', () => {
    expect(pickLanguage('es-MX,es;q=0.9,en;q=0.8')).toBe('es');
    expect(pickLanguage('fr-FR,fr;q=0.9,es;q=0.8,en;q=0.7')).toBe('es');
    expect(pickLanguage('en-US,es;q=0.5')).toBe('en');
    expect(pickLanguage('de-DE')).toBe('en');
    expect(pickLanguage(['es-419', 'en'])).toBe('es');
    expect(pickLanguage(null)).toBe('en');
  });
});
