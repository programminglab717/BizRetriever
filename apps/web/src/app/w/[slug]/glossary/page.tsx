import { getGlossary } from '@bizr/core/semantic';
import { CircleDashed } from 'lucide-react';
import Link from 'next/link';

import { Renameable } from '@/components/glossary/rename';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireWorkspace } from '@/lib/session';

const FORMAT: Record<string, string> = {
  money: 'Money',
  number: 'Number',
  percent: 'Percentage',
  days: 'Days',
};
const fmt = new Intl.NumberFormat('en-US');

/** "What we track" (PRODUCT_SPEC §3): the business glossary over the semantic catalog. */
export default async function GlossaryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const g = await getGlossary(member);
  const available = g.measures.filter((m) => m.available);
  const unavailable = g.measures.filter((m) => !m.available);
  const withRecords = g.recordTypes.filter((r) => r.count > 0);
  const empty = g.recordTypes.filter((r) => r.count === 0);

  if (g.measures.length === 0)
    return (
      <div className="grid gap-6">
        <PageHeader title="What we track" />
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <p>Once you bring in your files, this page lists everything we can measure for you.</p>
            <div>
              <Button asChild>
                <Link href={`/w/${slug}/data/import`}>Upload files</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="grid gap-8">
      <PageHeader
        title="What we track"
        description="The measures we work out from your data, how we calculate them, and the records they come from. Renaming something changes only what you see."
      />

      <section className="grid gap-3" aria-labelledby="measures">
        <h2 id="measures" className="text-lg font-semibold">
          Measures ({available.length})
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {available.map((m) => (
            <li key={m.key}>
              <Card className="h-full" data-testid={`measure-${m.key}`}>
                <CardContent className="grid gap-1 pt-6 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Renameable
                      slug={slug}
                      value={m.label}
                      className="font-medium"
                      target={{ kind: 'measure', key: m.key }}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {FORMAT[m.format]}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{m.description}</p>
                  {m.assumptions.map((a) => (
                    <p key={a} className="text-xs text-muted-foreground">
                      {a}
                    </p>
                  ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {unavailable.length > 0 ? (
        <section className="grid gap-3" aria-labelledby="unlock">
          <h2 id="unlock" className="text-lg font-semibold">
            Unlock more
          </h2>
          <p className="text-sm text-muted-foreground">
            These need information that isn’t in your files yet.
          </p>
          <ul className="grid gap-2">
            {unavailable.map((m) => (
              <li
                key={m.key}
                className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm"
                data-testid={`unavailable-${m.key}`}
              >
                <CircleDashed
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span>
                  <span className="font-medium">{m.label}</span>
                  <span className="block text-muted-foreground">{m.reason}</span>
                </span>
              </li>
            ))}
          </ul>
          <div>
            <Button asChild variant="outline">
              <Link href={`/w/${slug}/data/import`}>Add or update files</Link>
            </Button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3" aria-labelledby="records">
        <h2 id="records" className="text-lg font-semibold">
          Your records
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {withRecords.map((r) => (
            <Card key={r.key} data-testid={`record-type-${r.key}`}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Renameable
                    slug={slug}
                    value={r.plural}
                    target={{
                      kind: 'recordType',
                      key: r.key,
                      singular: r.singular,
                      plural: r.plural,
                    }}
                  />
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {fmt.format(r.count)} {r.count === 1 ? 'record' : 'records'} · {r.description}
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {r.links.length > 0 ? (
                  <ul className="grid gap-1 text-muted-foreground">
                    {r.links.map((l) => (
                      <li key={l}>{l}.</li>
                    ))}
                  </ul>
                ) : null}
                <details>
                  <summary className="cursor-pointer text-primary">
                    Details ({r.details.filter((d) => d.hasData).length})
                  </summary>
                  <ul className="mt-2 grid gap-1">
                    {r.details
                      .filter((d) => d.hasData)
                      .map((d) => (
                        <li key={d.key}>
                          <Renameable
                            slug={slug}
                            value={d.label}
                            target={{ kind: 'detail', recordType: r.key, key: d.key }}
                          />
                        </li>
                      ))}
                  </ul>
                  {r.details.some((d) => !d.hasData) ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Not in your files yet:{' '}
                      {r.details
                        .filter((d) => !d.hasData)
                        .map((d) => d.label.toLowerCase())
                        .join(', ')}
                      .
                    </p>
                  ) : null}
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
        {empty.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet for: {empty.map((r) => r.plural.toLowerCase()).join(', ')}.
          </p>
        ) : null}
      </section>
    </div>
  );
}
