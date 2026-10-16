import type { CatalogEntity } from '../change-plan/compile';
import type { ChangeOp, ChangePlan, FieldDef } from '../change-plan/schema';
import { words } from '../records/lookup';
import { entityByWord, fieldByWords } from '../records/write-rules';

/**
 * Task I, rules first: the usual ways owners ask to change what they track. Pure. Unclear requests
 * get a question; anything else goes to the AI.
 */

export type ChangeDraft = { plan: ChangePlan } | { clarify: string };

const KINDS: [RegExp, FieldDef['type']][] = [
  [/\b(?:date and time|time and date|datetime|timestamp)\b/i, 'datetime'],
  [/\b(?:yes\s*\/\s*no|yes or no|true or false|tick ?box|checkbox|whether)\b/i, 'boolean'],
  [/\b(?:percent(?:age)?|%|rate)\b/i, 'percent'],
  [/\b(?:money|price|cost|amount|fee|charge|value|spend|budget|wage|salary)\b/i, 'money'],
  [/\b(?:whole number|count|number of|how many|qty|quantity)\b/i, 'integer'],
  [/\b(?:decimal|number)\b/i, 'decimal'],
  [/\b(?:date|day|birthday|deadline|due)\b/i, 'date'],
  [/\btext\b/i, 'text'],
];

/** What kind of value a detail holds, from how the owner describes it. */
export function kindFrom(text: string): FieldDef['type'] {
  return KINDS.find(([re]) => re.test(text))?.[1] ?? 'text';
}

const EXPLICIT: [RegExp, Exclude<FieldDef['type'], 'reference'>][] = [
  [/^(?:a |an )?(?:date and time|datetime)$/i, 'datetime'],
  [/^(?:a |an )?date$/i, 'date'],
  [/^(?:a |an )?(?:yes\s*\/\s*no|yes or no|checkbox|tick ?box)$/i, 'boolean'],
  [/^(?:a |an )?whole number$/i, 'integer'],
  [/^(?:a |an )?(?:number|decimal)$/i, 'decimal'],
  [/^(?:an? )?(?:money|amount(?: of money)?|price)$/i, 'money'],
  [/^(?:a |an )?percent(?:age)?$/i, 'percent'],
  [/^(?:plain )?text$/i, 'text'],
];
const explicitKind = (s: string) => EXPLICIT.find(([re]) => re.test(s.trim()))?.[1];

const clean = (s: string) =>
  s
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;?!-]+$/g, '')
    .trim();
const NOISE = /\s+(?:detail|details|field|column|info|information|option)$/i;
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const keyOf = (s: string) =>
  words(s)
    .join('_')
    .replace(/_(id|ref)$/, '_$1x')
    .replace(/^(\d)/, 'n_$1')
    .slice(0, 40) || 'detail';
const valueKey = (s: string) =>
  clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

const singular = (s: string) => {
  const w = s.trim();
  if (/people$/i.test(w)) return w.replace(/people$/i, 'person');
  if (/ies$/i.test(w)) return w.replace(/ies$/i, 'y');
  if (/(ches|shes|xes|sses)$/i.test(w)) return w.replace(/es$/i, '');
  if (/s$/i.test(w) && !/ss$/i.test(w)) return w.replace(/s$/i, '');
  return w;
};

/** A detail named on its own ("brand") or on a record type ("brand on products"). */
function findField(
  catalog: readonly CatalogEntity[],
  fieldText: string,
  entityText?: string,
): { entity: CatalogEntity; field: FieldDef } | { clarify: string } | null {
  const ft = clean(fieldText).replace(NOISE, '');
  if (entityText) {
    const e = entityByWord(catalog, clean(entityText));
    const f = e ? fieldByWords(e, ft) : undefined;
    return e && f ? { entity: e, field: f } : null;
  }
  const hits = catalog.flatMap((e) => {
    const f = fieldByWords(e, ft);
    return f ? [{ entity: e, field: f }] : [];
  });
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1)
    return {
      clarify: `Which “${ft}” do you mean: ${hits.map((h) => `on ${h.entity.label.plural.toLowerCase()}`).join(' or ')}?`,
    };
  return null;
}

const plan = (...ops: ChangeOp[]): ChangeDraft => ({ plan: { ops } });

export function planChangeWithRules(
  request: string,
  catalog: readonly CatalogEntity[],
): ChangeDraft | null {
  const text = request
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;?!-]+$/g, '')
    .replace(/^(?:please|can you|could you|let'?s)\s+/i, '')
    .replace(/^(?:i|we)\s+(?:also\s+)?(?:want|need|would like|'d like)\s+to\s+/i, '')
    .replace(/^also\s+/i, '')
    .trim();
  if (!text) return null;
  let m: RegExpExecArray | null;

  // Unlink: "Unlink products from suppliers".
  if ((m = /^unlink\s+(.+?)\s+(?:from|and)\s+(.+)$/i.exec(text))) {
    const a = entityByWord(catalog, m[1]!);
    const b = entityByWord(catalog, m[2]!);
    const f =
      a && b ? a.fields.find((x) => x.type === 'reference' && x.references === b.key) : undefined;
    return a && f ? plan({ op: 'remove_relationship', entity: a.key, field: f.key }) : null;
  }

  // Allowed values: "Add 'on hold' as a status", "Allow market for sold through on sales".
  if (
    (m =
      /^(?:add|allow)\s+["“']?(.+?)["”']?\s+as\s+(?:a\s+|an\s+)?(?:new\s+|another\s+)?(?:option\s+for\s+|choice\s+for\s+)?(.+?)(?:\s+(?:on|for)\s+(.+))?$/i.exec(
        text,
      ))
  ) {
    const hit = findField(catalog, m[2]!, m[3]);
    if (!hit) return null;
    if ('clarify' in hit) return hit;
    if (!hit.field.allowedValues?.length) return null;
    return plan({
      op: 'add_allowed_values',
      entity: hit.entity.key,
      field: hit.field.key,
      values: [valueKey(m[1]!)],
    });
  }
  if (
    (m =
      /^(?:stop offering|remove)\s+["“'](.+?)["”']\s+(?:as\s+(?:a\s+|an\s+)?(?:option\s+for\s+)?|from\s+(?:the\s+)?(?:options?\s+for\s+)?)(.+?)(?:\s+(?:on|for)\s+(.+))?$/i.exec(
        text,
      ))
  ) {
    const hit = findField(catalog, m[2]!, m[3]);
    if (!hit) return null;
    if ('clarify' in hit) return hit;
    const v = valueKey(m[1]!);
    if (!hit.field.allowedValues?.includes(v)) return null;
    return plan({
      op: 'remove_allowed_values',
      entity: hit.entity.key,
      field: hit.field.key,
      values: [v],
    });
  }

  // Renames: "Rename sales to orders", "Rename selling price on products to RRP", "Call products “items”".
  if (
    (m =
      /^(?:rename|call)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:on|in|for)\s+(.+?))?\s+(?:to|as)\s+["“']?(.+?)["”']?(?:\s+instead)?$/i.exec(
        text,
      )) ??
    (m =
      /^call\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:on|in|for)\s+(.+?))?\s+["“'](.+?)["”'](?:\s+instead)?$/i.exec(
        text,
      ))
  ) {
    const to = clean(m[3]!);
    const e = m[2] ? undefined : entityByWord(catalog, m[1]!);
    if (e)
      return plan({
        op: 'rename_entity',
        entity: e.key,
        label: {
          singular: titleCase(singular(to)),
          plural: titleCase(singular(to) === to ? `${to}s` : to),
        },
      });
    const hit = findField(catalog, m[1]!, m[2]);
    if (!hit) return null;
    if ('clarify' in hit) return hit;
    return plan({
      op: 'rename_field',
      entity: hit.entity.key,
      field: hit.field.key,
      label: titleCase(to),
    });
  }

  // Kinds: "Make reorder point a whole number", "Change payment due on sales to a date and time".
  if (
    (m =
      /^(?:make|change|turn|convert|set)\s+(?:the\s+)?(.+?)(?:\s+(?:on|in|for)\s+(.+?))?\s+(?:into\s+|to\s+(?:be\s+)?)?(a\s+|an\s+)?(whole number|number|decimal|date and time|datetime|date|yes\s*\/\s*no|yes or no|checkbox|text|plain text|money|amount|price|percent(?:age)?)$/i.exec(
        text,
      )) ??
    (m =
      /^(?:the\s+)?(.+?)(?:\s+(?:on|in|for)\s+(.+?))?\s+should\s+be\s+(a\s+|an\s+)?(whole number|number|decimal|date and time|date|yes\s*\/\s*no|yes or no|text|money|amount|percent(?:age)?)$/i.exec(
        text,
      ))
  ) {
    const kind = explicitKind(m[4]!);
    const hit = findField(catalog, m[1]!, m[2]);
    if (!hit || !kind) return null;
    if ('clarify' in hit) return hit;
    return plan({
      op: 'change_field_type',
      entity: hit.entity.key,
      field: hit.field.key,
      type: kind,
    });
  }

  // Removals: "Remove brand from products", "Stop tracking variant on products", "Stop tracking expenses".
  if (
    (m =
      /^(?:remove|delete|drop|get rid of|stop tracking|stop recording|stop keeping track of)\s+(?:the\s+|my\s+|all\s+)?(.+?)(?:\s+(?:from|on|in|for)\s+(?:my\s+|the\s+|all\s+)?(.+))?$/i.exec(
        text,
      ))
  ) {
    if (!m[2]) {
      const e = entityByWord(catalog, m[1]!.replace(NOISE, ''));
      if (e) return plan({ op: 'remove_entity', entity: e.key });
    }
    const hit = findField(catalog, m[1]!, m[2]);
    if (!hit) return null;
    if ('clarify' in hit) return hit;
    return plan({ op: 'remove_field', entity: hit.entity.key, field: hit.field.key });
  }

  // "Track which salesperson made each sale", "Add a gift wrap (yes/no) to sales",
  // "Track the delivery date for each sale".
  if (
    (m =
      /^(?:track|record|keep track of|store|note)\s+(?:which|what|who|the)\s+(.+?)\s+(?:made|sold|handled|took|served|packed|shipped|delivered|did|was used for|for|on|of)\s+(?:each|every|a|the|my)?\s*(.+)$/i.exec(
        text,
      )) ??
    (m =
      /^(?:add|track|record|keep track of|store)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(.+?)\s+(?:to|for|on|with)\s+(?:each\s+|every\s+|all\s+|my\s+|the\s+)?(.+)$/i.exec(
        text,
      ))
  ) {
    const e = entityByWord(catalog, clean(m[2]!));
    if (!e) return null;
    let name = clean(m[1]!).replace(NOISE, '');
    const paren = /^(.+?)\s*\((.+)\)$/.exec(name);
    let type = kindFrom(name);
    if (paren) {
      name = clean(paren[1]!);
      type = explicitKind(paren[2]!) ?? kindFrom(paren[2]!);
    }
    const as = /^(.+?)\s+as\s+(.+)$/i.exec(name);
    if (as && explicitKind(as[2]!)) {
      name = clean(as[1]!);
      type = explicitKind(as[2]!)!;
    }
    if (!name || fieldByWords(e, name))
      return fieldByWords(e, name)
        ? { clarify: `${e.label.plural} already have “${fieldByWords(e, name)!.label}”.` }
        : null;
    // A detail named after another record type is a link ("which customer" → link to customers).
    const target = entityByWord(catalog, name);
    if (target && target.key !== e.key && !e.fields.some((f) => f.references === target.key))
      return plan({
        op: 'add_field',
        entity: e.key,
        field: {
          key: keyOf(name),
          label: titleCase(name),
          type: 'reference',
          references: target.key,
          required: false,
          pii: false,
        },
      });
    return plan({
      op: 'add_field',
      entity: e.key,
      field: { key: keyOf(name), label: titleCase(name), type, required: false, pii: false },
    });
  }

  // New record types: "Start tracking salespeople", "Keep track of my markets".
  if (
    (m =
      /^(?:start\s+)?(?:tracking|track|keeping track of|keep track of)\s+(?:my\s+|our\s+)?([a-z][a-z ]{1,40})$/i.exec(
        text,
      ))
  ) {
    const name = clean(m[1]!);
    if (entityByWord(catalog, name)) return { clarify: `You already track ${name.toLowerCase()}.` };
    const one = titleCase(singular(name));
    const many = titleCase(name.toLowerCase() === singular(name).toLowerCase() ? `${name}s` : name);
    return plan({
      op: 'create_entity',
      key: keyOf(singular(name)),
      label: { singular: one, plural: many },
      description: '',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true, pii: false, semantic: 'name' },
      ],
      naturalKeys: [['name']],
    });
  }
  return null;
}
