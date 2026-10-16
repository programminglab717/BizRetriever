import type { ColumnProfile, DateOrder, RegionProfile } from '@bizr/ingest';
import type { PackData } from '@bizr/packs';

import type {
  FieldMapping,
  ModelProposal,
  SourceMapping,
  TargetMapping,
  WireColumnRef,
  WireValueRule,
} from './proposal';

/**
 * Deterministic baseline proposer. Uses the pack's header synonyms, value synonyms and known formats
 * plus the column profiles to recognise common table shapes (order lines, product lists, supplier
 * orders, returns, wide monthly expenses). It needs no AI, so ingestion always works; the AI then
 * refines this proposal for files it doesn't fully understand.
 */

export interface ProfiledSource {
  sourceId: string;
  fileName: string;
  sheetName: string;
  profile: RegionProfile;
}

export interface HeuristicContext {
  pack: PackData;
  dateOrder: DateOrder;
  /** Upload date (YYYY-MM-DD): when stock levels on a product list were counted. */
  today: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

type FieldRef = `${string}.${string}`;

interface ColumnMatch {
  column: ColumnProfile;
  score: number;
}

class SourceAnalysis {
  readonly used = new Set<number>();
  constructor(
    readonly source: ProfiledSource,
    readonly ctx: HeuristicContext,
  ) {}

  get columns() {
    return this.source.profile.columns;
  }

  share(c: ColumnProfile, kind: keyof ColumnProfile['kinds']): number {
    return c.filled === 0 ? 0 : c.kinds[kind] / c.filled;
  }

  isNumeric(c: ColumnProfile) {
    return c.filled > 0 && (c.kinds.number + c.kinds.withUnit) / c.filled >= 0.6;
  }

  isDate(c: ColumnProfile) {
    return c.filled > 0 && c.kinds.date / c.filled >= 0.6;
  }

  /** Order-level column on a line-level export: filled on the first row of each group only. */
  isGroupLevel(c: ColumnProfile) {
    return c.blank > 0 && c.blankWithinGroup / Math.max(1, c.blank) >= 0.8;
  }

  typeOk(ref: FieldRef, c: ColumnProfile): boolean {
    const [entity, field] = ref.split('.') as [string, string];
    const def = this.ctx.pack.entities
      .find((e) => e.id === entity)
      ?.fields.find((f) => f.id === field);
    if (!def) return false;
    switch (def.type) {
      case 'date':
      case 'datetime':
        return this.isDate(c);
      case 'integer':
      case 'decimal':
      case 'money':
      case 'percent':
        return this.isNumeric(c);
      case 'boolean':
        return c.kinds.boolean / Math.max(1, c.filled) >= 0.6;
      default:
        return c.filled > 0;
    }
  }

  /** Best unused column for any of these fields, by synonym (exact beats contained; earlier synonyms win ties). */
  find(
    refs: FieldRef[],
    opts: { exclude?: Set<number>; filter?: (c: ColumnProfile) => boolean; take?: boolean } = {},
  ): ColumnProfile | undefined {
    let best: ColumnMatch | undefined;
    for (const c of this.columns) {
      if (this.used.has(c.index) || opts.exclude?.has(c.index)) continue;
      if (opts.filter && !opts.filter(c)) continue;
      const header = norm(c.header);
      for (const ref of refs) {
        if (!this.typeOk(ref, c)) continue;
        const synonyms = (this.ctx.pack.synonyms.fields[ref] ?? []).map(norm);
        synonyms.forEach((syn, rank) => {
          let score = 0;
          if (header === syn) score = 2 - rank * 0.01;
          else if (syn.length >= 3 && ` ${header} `.includes(` ${syn} `))
            score = 1 + syn.length / 100 - rank * 0.001;
          if (score > (best?.score ?? 0)) best = { column: c, score };
        });
      }
    }
    if (best && opts.take !== false) this.used.add(best.column.index);
    return best?.column;
  }

  release(c: ColumnProfile | undefined) {
    if (c) this.used.delete(c.index);
  }
}

function col(c: ColumnProfile | undefined): WireColumnRef | undefined {
  return c?.index;
}

function mapping(
  field: string,
  column: WireColumnRef | undefined,
  rules: WireValueRule[] = [],
  extra: Partial<FieldMapping> = {},
): FieldMapping[] {
  if (column === undefined) return [];
  return [{ field, source: { kind: 'column', column }, rules, confidence: 0.8, ...extra }];
}

function constant(field: string, value: string): FieldMapping {
  return { field, source: { kind: 'constant', value }, rules: [], confidence: 0.7 };
}

function firstOf(
  field: string,
  columns: (ColumnProfile | undefined)[],
  extra: Partial<FieldMapping> = {},
): FieldMapping[] {
  const present = columns.filter((c): c is ColumnProfile => c !== undefined).map((c) => c.index);
  if (present.length === 0) return [];
  if (present.length === 1)
    return [
      {
        field,
        source: { kind: 'column', column: present[0]! },
        rules: [],
        confidence: 0.75,
        ...extra,
      },
    ];
  return [
    {
      field,
      source: { kind: 'first_of', columns: present },
      rules: [],
      confidence: 0.75,
      ...extra,
    },
  ];
}

/** map_values rule built from the pack's value synonyms, covering the values actually seen. */
function valueMap(ctx: HeuristicContext, ref: FieldRef, c: ColumnProfile): WireValueRule[] {
  const synonyms = ctx.pack.synonyms.values[ref];
  if (!synonyms) return [];
  const pairs: { from: string; to: string }[] = [];
  for (const { value } of c.topValues) {
    const v = norm(value);
    for (const [canonical, words] of Object.entries(synonyms)) {
      if (words.map(norm).includes(v) || norm(canonical) === v)
        pairs.push({ from: value, to: canonical });
    }
  }
  return pairs.length > 0 ? [{ rule: 'map_values', pairs, otherwise: 'keep' }] : [];
}

function channelFor(ctx: HeuristicContext, names: string[]): string | undefined {
  const text = ` ${names.map(norm).join(' ')} `;
  for (const [channel, words] of Object.entries(ctx.pack.synonyms.source_channels)) {
    if (words.some((w) => text.includes(` ${norm(w)} `))) return channel;
  }
  return undefined;
}

function yearIn(names: string[], fallback: string): number {
  for (const n of names) {
    const m = /(19|20)\d{2}/.exec(n);
    if (m) return Number(m[0]);
  }
  return Number(fallback.slice(0, 4));
}

function knownFormat(
  ctx: HeuristicContext,
  profile: RegionProfile,
): { id: string; label: string } | undefined {
  const headers = new Set(profile.columns.map((c) => norm(c.header)));
  let best: { id: string; label: string; overlap: number } | undefined;
  for (const f of ctx.pack.knownFormats) {
    const overlap = f.headers.filter((h) => headers.has(norm(h))).length / f.headers.length;
    if (overlap >= 0.6 && overlap > (best?.overlap ?? 0))
      best = { id: f.id, label: f.label, overlap };
  }
  return best;
}

export interface HeuristicResult {
  proposal: ModelProposal;
  /** Human-readable things we spotted, for the processing screen ("Found a sheet that looks like Etsy orders"). */
  spotted: string[];
}

export function proposeHeuristically(
  sources: readonly ProfiledSource[],
  ctx: HeuristicContext,
): HeuristicResult {
  const out: ModelProposal = { sources: [], dedupe: [], assumptions: [], questions: [] };
  const spotted: string[] = [];
  const dateOrderConflicts: { sourceId: string; name: string; implied: DateOrder }[] = [];
  const dedupeCandidates: {
    entity: string;
    key: string;
    variants: string[];
    weight: number;
    /** How often each spelling appears. */
    counts: Map<string, number>;
  }[] = [];
  const costColumns: { sourceId: string; name: string; header: string }[] = [];
  const label = (s: ProfiledSource) =>
    s.sheetName === s.fileName ? s.fileName : `${s.fileName} › ${s.sheetName}`;

  for (const source of sources) {
    const a = new SourceAnalysis(source, ctx);
    const p = source.profile;
    const names = [source.fileName, source.sheetName];
    const fmt = knownFormat(ctx, p);
    if (fmt) spotted.push(`Found a sheet that looks like ${fmt.label} (${label(source)})`);

    const dateRules = (c: ColumnProfile | undefined): WireValueRule[] => {
      if (!c?.date) return [];
      const implied = c.date.impliedOrder;
      if (implied && implied !== ctx.dateOrder) {
        dateOrderConflicts.push({ sourceId: source.sourceId, name: label(source), implied });
        return [{ rule: 'parse_date', order: implied }];
      }
      return [];
    };

    const rowRules: SourceMapping['rowRules'] = [];
    const targets: TargetMapping[] = [];

    // --- Wide monthly sheet (e.g. expenses with Jan…Dec columns) ---
    if (p.monthColumns.length >= 3) {
      const category = a.columns.find(
        (c) => !p.monthColumns.includes(c.index) && c.kinds.text > c.filled * 0.5,
      );
      rowRules.push({ rule: 'unpivot', columns: p.monthColumns });
      const year = yearIn(names, ctx.today);
      targets.push({
        entity: 'expense',
        grain: 'row',
        fields: [
          ...mapping('category', col(category)),
          {
            field: 'expense_date',
            source: { kind: 'column', column: 'unpivot_key' },
            rules: [{ rule: 'month_start', year }],
            confidence: 0.85,
          },
          {
            field: 'amount',
            source: { kind: 'column', column: 'unpivot_value' },
            rules: [],
            confidence: 0.85,
          },
        ],
      });
      out.assumptions.push({
        id: `${source.sourceId}-months`,
        about: label(source),
        text: `“${label(source)}” has a separate amount for each month. We’ll record each amount on the first day of its month in ${year}.`,
        confidence: 0.8,
      });
    }

    const qty =
      targets.length === 0
        ? a.find(['sale_line.quantity', 'purchase_line.quantity', 'return.quantity'], {
            take: false,
          })
        : undefined;
    const date =
      targets.length === 0
        ? a.find(
            ['sale.sale_date', 'purchase.order_date', 'return.return_date', 'expense.expense_date'],
            { take: false },
          )
        : undefined;
    const productName = a.find(['product.name'], { take: false });
    const sku = a.find(['product.sku'], { take: false });
    const supplierCol = a.find(['purchase.supplier', 'product.supplier', 'supplier.name'], {
      take: false,
    });
    const poCol = a.find(['purchase.po_number'], {
      take: false,
      filter: (c) => /\bpo\b|purchase/.test(norm(c.header)),
    });
    const reasonCol = a.find(['return.reason'], { take: false });
    const looksLikeReturns = reasonCol !== undefined && /return|refund/i.test(names.join(' '));

    if (targets.length === 0 && looksLikeReturns && qty) {
      // --- Returns log ---
      const d = a.find(['return.return_date']);
      targets.push({
        entity: 'return',
        grain: 'row',
        fields: [
          ...mapping('return_date', col(d), dateRules(d)),
          ...mapping(
            'sale',
            col(a.find(['sale.order_number'], { filter: (c) => c.kinds.text > 0 })),
          ),
          ...firstOf('product', [a.find(['product.sku']), a.find(['product.name'])], {
            matchOn: ['sku', 'name'],
          }),
          ...mapping('quantity', col(a.find(['return.quantity']))),
          ...mapping('refund_amount', col(a.find(['return.refund_amount']))),
          ...mapping('reason', col(a.find(['return.reason']))),
        ],
      });
    } else if (targets.length === 0 && poCol && qty && supplierCol) {
      // --- Supplier orders (purchase lines) ---
      a.used.add(poCol.index);
      const supplier = a.find(['supplier.name', 'product.supplier'])!;
      const orderDate = a.find(['purchase.order_date']);
      const received = a.find(['purchase.received_date']);
      const skuC = a.find(['product.sku']);
      const nameC = a.find(['product.name']);
      targets.push(
        {
          entity: 'purchase',
          grain: 'group',
          groupBy: [poCol.index],
          fields: [
            ...mapping('po_number', poCol.index),
            ...mapping('supplier', supplier.index, [], { matchOn: ['name'] }),
            ...mapping('order_date', col(orderDate), dateRules(orderDate)),
            ...mapping('received_date', col(received), dateRules(received)),
          ],
        },
        {
          entity: 'purchase_line',
          grain: 'row',
          fields: [
            ...mapping('purchase', poCol.index),
            ...firstOf('product', [skuC, nameC], { matchOn: ['sku', 'name'] }),
            ...mapping('quantity', col(a.find(['purchase_line.quantity']))),
            ...mapping('unit_cost', col(a.find(['purchase_line.unit_cost']))),
            ...mapping('line_total', col(a.find(['purchase_line.line_total']))),
          ],
        },
        {
          entity: 'supplier',
          grain: 'group',
          groupBy: [supplier.index],
          fields: mapping('name', supplier.index),
        },
      );
    } else if (targets.length === 0 && qty && date && (productName || sku)) {
      // --- Order lines (website, marketplace, till, wholesale invoices) ---
      const channel = channelFor(ctx, names) ?? 'other';
      const groupKey =
        p.groupKeyColumn !== undefined
          ? a.columns.find((c) => c.index === p.groupKeyColumn)
          : undefined;
      const orderCol =
        groupKey ??
        a.find(['sale.order_number'], {
          take: false,
          filter: (c) => c.kinds.text > 0 || c.kinds.number > 0,
        });
      if (orderCol) a.used.add(orderCol.index);
      const qtyC = a.find(['sale_line.quantity'])!;
      const dateC = a.find(['sale.sale_date'])!;
      const emailC = a.find(['customer.email']);
      const nameC = a.find(['customer.name']);
      const statusC = a.find(['sale.status'], { filter: (c) => c.kinds.text > 0 });
      const paidC = a.find(['sale.payment_status'], {
        filter: (c) => c.kinds.boolean + c.kinds.text > 0,
      });
      const dueC = a.find(['sale.due_date']);
      const skuC = a.find(['product.sku']);
      const productC = a.find(['product.name']);
      const cityC = a.find(['customer.city']);
      const regionC = a.find(['customer.region']);
      const countryC = a.find(['customer.country']);
      const groupLevel = (c: ColumnProfile) => (groupKey ? a.isGroupLevel(c) : false);
      const lineLevel = (c: ColumnProfile) => !groupLevel(c);
      const shippingC = a.find(['sale.shipping_charged'], {
        filter: groupKey ? groupLevel : undefined,
      });
      const taxC = a.find(['sale.tax_total'], { filter: groupKey ? groupLevel : undefined });
      const totalC = groupKey ? a.find(['sale.total'], { filter: groupLevel }) : undefined;
      const orderDiscountC = groupKey
        ? a.find(['sale.discount_total'], { filter: groupLevel })
        : undefined;
      const lineDiscountC = a.find(['sale_line.discount'], { filter: lineLevel });
      const lineTotalC = a.find(['sale_line.line_total'], { filter: lineLevel });
      const priceC = a.find(['sale_line.unit_price'], { filter: lineLevel });
      const hasRefunds = (qtyC.number?.negative ?? 0) > 0;

      const customerKey = emailC ?? nameC;
      const orderFields = [
        orderCol,
        dateC,
        emailC,
        nameC,
        statusC,
        cityC,
        regionC,
        countryC,
      ].filter(
        (c): c is ColumnProfile =>
          c !== undefined &&
          groupKey !== undefined &&
          c.index !== groupKey.index &&
          a.isGroupLevel(c),
      );
      if (groupKey && orderFields.length > 0) {
        rowRules.push({
          rule: 'fill_down',
          columns: orderFields.map((c) => c.index),
          withinGroup: groupKey.index,
        });
      }
      const positive = hasRefunds ? { where: { column: qtyC.index, op: 'positive' as const } } : {};

      const saleFields: FieldMapping[] = [
        ...(orderCol ? mapping('order_number', orderCol.index) : []),
        ...mapping('sale_date', dateC.index, dateRules(dateC)),
        constant('channel', channel),
        ...(customerKey
          ? mapping('customer', customerKey.index, [], {
              matchOn: emailC ? ['email', 'name'] : ['name'],
            })
          : []),
        ...(statusC
          ? mapping('status', statusC.index, valueMap(ctx, 'sale.status', statusC))
          : [constant('status', 'completed')]),
        ...mapping(
          'payment_status',
          col(paidC),
          paidC ? valueMap(ctx, 'sale.payment_status', paidC) : [],
        ),
        ...mapping('due_date', col(dueC), dateRules(dueC)),
        ...mapping('discount_total', col(orderDiscountC)),
        ...mapping('shipping_charged', col(shippingC)),
        ...mapping('tax_total', col(taxC)),
        ...mapping('total', col(totalC)),
      ];
      targets.push({
        entity: 'sale',
        grain: orderCol ? 'group' : 'row',
        ...(orderCol ? { groupBy: [orderCol.index] } : {}),
        ...positive,
        fields: saleFields,
      });

      const lineFields: FieldMapping[] = [
        ...(orderCol ? mapping('sale', orderCol.index) : []),
        ...(orderCol
          ? [
              {
                field: 'line_number',
                source: { kind: 'sequence' as const, within: orderCol.index },
                rules: [],
                confidence: 0.7,
              },
            ]
          : []),
        ...firstOf('product', [skuC, productC], { matchOn: ['sku', 'name'] }),
        ...mapping('product_name_raw', col(productC)),
        ...mapping('quantity', qtyC.index),
        ...mapping('unit_price', col(priceC)),
        ...mapping('discount', col(lineDiscountC)),
        ...mapping('line_total', col(lineTotalC)),
      ];
      if (!lineTotalC && priceC) {
        lineFields.push({
          field: 'line_total',
          source: {
            kind: 'derive',
            expr: {
              op: 'sub',
              args: [
                { op: 'mul', args: [{ field: 'quantity' }, { field: 'unit_price' }] },
                { field: 'discount' },
              ],
            },
          },
          rules: [],
          confidence: 0.7,
        });
        if (!lineDiscountC) {
          lineFields[lineFields.length - 1]!.source = {
            kind: 'derive',
            expr: { op: 'mul', args: [{ field: 'quantity' }, { field: 'unit_price' }] },
          };
        }
      }
      if (!priceC && lineTotalC) {
        lineFields.push({
          field: 'unit_price',
          source: {
            kind: 'derive',
            expr: {
              op: 'div',
              args: [
                { op: 'add', args: [{ field: 'line_total' }, { field: 'discount' }] },
                { field: 'quantity' },
              ],
            },
          },
          rules: [],
          confidence: 0.6,
        });
      }
      targets.push({ entity: 'sale_line', grain: 'row', ...positive, fields: lineFields });

      if (customerKey) {
        targets.push({
          entity: 'customer',
          grain: 'group',
          groupBy: [customerKey.index],
          fields: [
            ...mapping('email', col(emailC)),
            ...mapping('name', col(nameC)),
            ...mapping('city', col(cityC)),
            ...mapping('region', col(regionC)),
            ...mapping('country', col(countryC)),
            ...(channel === 'wholesale' ? [constant('customer_type', 'wholesale')] : []),
          ],
        });
        if (nameC && nameC.nearDuplicates.length > 0) {
          for (const d of nameC.nearDuplicates) {
            const counts = new Map(nameC.topValues.map((t) => [t.value, t.count]));
            dedupeCandidates.push({
              entity: 'customer',
              key: d.key,
              variants: d.variants,
              weight: d.variants.reduce((s, v) => s + (counts.get(v) ?? 1), 0),
              counts,
            });
          }
        }
      }

      if (hasRefunds) {
        targets.push({
          entity: 'return',
          grain: 'row',
          where: { column: qtyC.index, op: 'negative' },
          fields: [
            ...mapping('return_date', dateC.index, dateRules(dateC)),
            ...firstOf('product', [skuC, productC], { matchOn: ['sku', 'name'] }),
            ...mapping('quantity', qtyC.index, [{ rule: 'negate' }]),
            ...(lineTotalC ? mapping('refund_amount', lineTotalC.index, [{ rule: 'negate' }]) : []),
          ],
        });
        out.assumptions.push({
          id: `${source.sourceId}-refunds`,
          about: label(source),
          text: `Lines with a negative quantity in “${label(source)}” look like refunds. We’ll record them as returns, not sales.`,
          confidence: 0.75,
        });
      }
      if (fmt?.id === 'shopify_orders') {
        out.assumptions.push({
          id: `${source.sourceId}-name`,
          about: label(source),
          text: 'In this Shopify export, “Name” is the order number, not a person’s name.',
          confidence: 0.9,
        });
      }
    } else if (
      targets.length === 0 &&
      productName &&
      (a.find(['product.unit_price', 'product.unit_cost'], { take: false }) || sku)
    ) {
      // --- Product list (with optional stock and supplier columns) ---
      const skuC = a.find(['product.sku']);
      const nameC = a.find(['product.name'])!;
      const costC = a.find(['product.unit_cost']);
      const priceC = a.find(['product.unit_price']);
      const supplierC = a.find(['product.supplier', 'supplier.name']);
      const categoryC = a.find(['product.category'], { filter: (c) => c.kinds.text > 0 });
      const reorderC = a.find(['product.reorder_point']);
      const stockC = a.find(['stock_count.quantity_on_hand']);
      const fields: FieldMapping[] = [
        ...mapping('sku', col(skuC)),
        ...mapping('name', nameC.index),
        ...mapping('unit_cost', col(costC)),
        ...mapping('unit_price', col(priceC)),
        ...mapping('supplier', col(supplierC), [], { matchOn: ['name'] }),
        ...mapping('reorder_point', col(reorderC)),
      ];
      if (categoryC) fields.push(...mapping('category', categoryC.index));
      else if (p.sections.length > 0) {
        fields.push({
          field: 'category',
          source: { kind: 'column', column: 'section' },
          rules: [{ rule: 'case', to: 'title' }],
          confidence: 0.75,
        });
        out.assumptions.push({
          id: `${source.sourceId}-sections`,
          about: label(source),
          text: `Headings like “${p.sections[0]}” in “${label(source)}” are product categories. We’ll attach each product to the heading above it.`,
          confidence: 0.8,
        });
      }
      targets.push({ entity: 'product', grain: 'row', fields });
      if (stockC) {
        targets.push({
          entity: 'stock_count',
          grain: 'row',
          fields: [
            ...firstOf('product', [skuC, nameC], { matchOn: ['sku', 'name'] }),
            constant('counted_at', ctx.today),
            ...mapping('quantity_on_hand', stockC.index),
          ],
        });
        out.assumptions.push({
          id: `${source.sourceId}-stock`,
          about: label(source),
          text: `The stock numbers in “${label(source)}” are how many you have today.`,
          confidence: 0.7,
        });
      }
      if (supplierC)
        targets.push({
          entity: 'supplier',
          grain: 'group',
          groupBy: [supplierC.index],
          fields: mapping('name', supplierC.index),
        });
      if (costC)
        costColumns.push({ sourceId: source.sourceId, name: label(source), header: costC.header });
    }

    if (targets.length === 0) {
      out.sources.push({
        sourceId: source.sourceId,
        decision: 'ignore',
        ignoreReason: 'We couldn’t tell what this table holds yet.',
        rowRules: [],
        targets: [],
      });
      continue;
    }
    const sm: SourceMapping = { sourceId: source.sourceId, decision: 'map', rowRules, targets };
    if (fmt) sm.knownFormat = fmt.id;
    out.sources.push(sm);
  }

  // --- Spelling variants (dedupe), most important first ---
  dedupeCandidates.sort((x, y) => y.weight - x.weight);
  const seenKeys = new Set<string>();
  const clusters: ModelProposal['dedupe'][number]['clusters'] = [];
  const allVariants = new Map<string, Set<string>>();
  for (const d of dedupeCandidates) {
    const set = allVariants.get(d.key) ?? new Set<string>();
    d.variants.forEach((v) => set.add(v));
    allVariants.set(d.key, set);
  }
  for (const d of dedupeCandidates) {
    if (seenKeys.has(d.key)) continue;
    seenKeys.add(d.key);
    const variants = [...allVariants.get(d.key)!];
    // The spelling used most often is the name to keep ("Bloom & Co", not a one-off "Bloom and Co.").
    const tally = (v: string) =>
      dedupeCandidates
        .filter((x) => x.key === d.key)
        .reduce((t, x) => t + (x.counts.get(v) ?? 0), 0);
    const canonicalName = variants.reduce((best, v) => (tally(v) > tally(best) ? v : best));
    clusters.push({
      canonical: canonicalName,
      variants: variants.filter((v) => v !== canonicalName),
    });
  }
  if (clusters.length > 0) {
    out.dedupe.push({ entity: 'customer', clusters });
    const top = clusters[0]!;
    const names = [top.canonical, ...top.variants];
    out.questions.push({
      id: 'dedupe-customer-1',
      text: `Are ${names
        .map((n) => `“${n}”`)
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1')} the same customer?`,
      about: 'customers',
      options: [
        {
          id: 'same',
          label: 'Yes, same customer',
          effect: { kind: 'keep_dedupe', entity: 'customer', canonical: top.canonical },
        },
        {
          id: 'different',
          label: 'No, they’re different',
          effect: { kind: 'drop_dedupe', entity: 'customer', canonical: top.canonical },
        },
      ],
      defaultOption: 'same',
    });
    if (clusters.length > 1) {
      out.assumptions.push({
        id: 'dedupe-more',
        about: 'customers',
        text: `We also found other customer names written in slightly different ways (like “${clusters[1]!.variants[0]}”) and will treat each group as one customer.`,
        confidence: 0.7,
      });
    }
  }

  // --- Day-first vs month-first dates ---
  const byOrder = new Map<DateOrder, typeof dateOrderConflicts>();
  for (const c of dateOrderConflicts)
    byOrder.set(c.implied, [...(byOrder.get(c.implied) ?? []), c]);
  for (const [implied, list] of byOrder) {
    const ids = [...new Set(list.map((l) => l.sourceId))];
    const where = [...new Set(list.map((l) => `“${l.name}”`))].join(', ');
    const example = implied === 'DMY' ? '25/03/2026' : '03/25/2026';
    if (out.questions.length < 3) {
      out.questions.push({
        id: `dates-${implied}`,
        text: `The dates in ${where} look ${implied === 'DMY' ? 'day-first' : 'month-first'} (like ${example}). Is that right?`,
        about: 'dates',
        options: [
          {
            id: 'yes',
            label: 'Yes',
            effect: { kind: 'set_date_order', sourceIds: ids, order: implied },
          },
          {
            id: 'no',
            label: 'No',
            effect: { kind: 'set_date_order', sourceIds: ids, order: ctx.dateOrder },
          },
        ],
        defaultOption: 'yes',
      });
    }
  }

  // --- Cost per item? ---
  const cost = costColumns[0];
  if (cost && out.questions.length < 3) {
    out.questions.push({
      id: 'cost-per-item',
      text: `Does “${cost.header}” in “${cost.name}” mean the cost of one item?`,
      about: 'products',
      options: [
        { id: 'per_item', label: 'Yes, per item', effect: { kind: 'none' } },
        {
          id: 'total',
          label: 'No, it’s a total',
          effect: {
            kind: 'unmap_field',
            sourceId: cost.sourceId,
            entity: 'product',
            field: 'unit_cost',
          },
        },
      ],
      defaultOption: 'per_item',
    });
  }

  return { proposal: out, spotted };
}
