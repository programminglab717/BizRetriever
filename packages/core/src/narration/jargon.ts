/**
 * Words we never show in primary flows (PRODUCT_SPEC §2). Used to check AI-written text and our own
 * generated copy. Text inside curly quotes (“…”) is ignored: those are the user's own names for things,
 * e.g. a sheet called “Stock table”.
 */
const BANNED: readonly { pattern: RegExp; word: string }[] = [
  ['schema', 'schemas?|schemata'],
  ['table', 'tables?'],
  ['database', 'databases?'],
  ['row', 'rows?'],
  ['column', 'columns?'],
  ['field', 'fields?'],
  ['query', 'query|queries'],
  ['SQL', 'sql'],
  ['join', 'joins?|joined|joining'],
  ['foreign key', 'foreign\\s+keys?'],
  ['relationship', 'relationships?'],
  ['null', 'nulls?'],
  ['NaN', 'nan'],
  ['undefined', 'undefined'],
  ['ingest', 'ingest|ingests|ingested|ingestion'],
  ['ETL', 'etl'],
  ['pipeline', 'pipelines?'],
  ['dedupe', 'dedupe|deduped|dedupes|dedup|deduplicat\\w*'],
  ['parse', 'parse|parsed|parses|parsing|parser'],
  ['metric', 'metrics?'],
  ['aggregate', 'aggregates?|aggregated|aggregation'],
  ['migration', 'migrations?'],
  ['entity', 'entity|entities'],
].map(([word, alternatives]) => ({
  word: word!,
  pattern: new RegExp(`\\b(?:${alternatives!})\\b`, 'i'),
}));

const QUOTED = /“[^”]*”/g;

/** The banned words found in `text` (empty when the text is fine). */
export function findJargon(text: string): string[] {
  const unquoted = text.replace(QUOTED, ' ');
  return BANNED.filter((b) => b.pattern.test(unquoted)).map((b) => b.word);
}
