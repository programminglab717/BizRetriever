import { browseRecords, RecordsError, type BrowseInput } from '@bizr/core/records';
import { notFound } from 'next/navigation';

import { RecordsBrowser } from '@/components/records/records-browser';
import { requireWorkspace } from '@/lib/session';

type Search = Record<string, string | string[] | undefined>;

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** URL → what to show: `?q=` search, `?sort=&dir=`, `?f=field:value` (repeatable), `?deleted=1`. */
function browseInput(entity: string, sp: Search): BrowseInput {
  const filters = [sp.f ?? []]
    .flat()
    .slice(0, 10)
    .map((f) => {
      const i = f.indexOf(':');
      const field = f.slice(0, i);
      const value = f.slice(i + 1);
      return i > 0 && KEY.test(field)
        ? { field, value: value === '' ? null : value.slice(0, 100) }
        : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
  const sort = one(sp.sort);
  const dir = one(sp.dir);
  return {
    entity,
    search: one(sp.q)?.slice(0, 100),
    sort: sort && KEY.test(sort) ? sort : undefined,
    dir: dir === 'asc' || dir === 'desc' ? dir : undefined,
    filters,
    deleted: one(sp.deleted) === '1',
    limit: 100,
  };
}

export default async function RecordTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; entity: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug, entity } = await params;
  const member = await requireWorkspace(slug);
  if (!KEY.test(entity)) notFound();
  const input = browseInput(entity, await searchParams);
  let initial;
  try {
    initial = await browseRecords(member, input);
  } catch (err) {
    if (err instanceof RecordsError) notFound();
    throw err;
  }
  // A new search, sort or filter starts the grid afresh.
  const viewKey = JSON.stringify([
    input.search,
    initial.sort,
    initial.dir,
    input.filters,
    input.deleted,
  ]);
  return (
    <RecordsBrowser
      key={viewKey}
      slug={slug}
      currency={member.settings.currency}
      initial={initial}
      query={{
        search: input.search ?? '',
        filters: input.filters ?? [],
        deleted: input.deleted ?? false,
      }}
    />
  );
}
