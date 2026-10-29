import { noteText, reorderList, type ReorderLine } from '@bizr/core/planning';
import { localeFor } from '@bizr/core/ask';
import Link from 'next/link';

import { DownloadLinks } from '@/components/ask/answer-card';
import { ComingSoon, PageHeader } from '@/components/shell/page-header';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** What to reorder (M11): products whose stock won't last lead time + 30 days, by supplier. */
export default async function ReorderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await requireWorkspace(slug);
  const t = await getT();
  const list = await reorderList(member);
  const back = (
    <Link href={`/w/${slug}/plan`} className="text-sm text-primary underline underline-offset-4">
      {t('Back to Plan ahead')}
    </Link>
  );
  if (!list.available)
    return (
      <div className="grid gap-6">
        <PageHeader title={t('What to reorder')} description={back} />
        <ComingSoon title={t('Bring in a stock list and your sales')}>
          <p>
            {t('With how many you have and how fast they sell, we can tell you what to order.')}
          </p>
        </ComingSoon>
      </div>
    );
  const bySupplier = new Map<string, ReorderLine[]>();
  for (const l of list.lines) {
    const k = l.supplier ?? t('No supplier recorded');
    bySupplier.set(k, [...(bySupplier.get(k) ?? []), l]);
  }
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={t('What to reorder')}
        description={
          <>
            {t(
              'Products whose stock won’t last the supplier’s lead time plus 30 days, at the rate they’ve sold for the last 4 weeks.',
            )}{' '}
            {back}
          </>
        }
      />
      {list.lines.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          {t('Nothing needs ordering right now.')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {list.seasonNote
                ? `${t.text(noteText(list.seasonNote, localeFor(member.settings, t.lang)))} ${t('The amounts allow for it.')}`
                : t('Amounts are at your recent rate.')}{' '}
              {list.perProductSeasons
                ? `${t('Each product’s own season from last year is allowed for too.')} `
                : ''}
              {t('Lead time is 14 days where none is recorded.')}
            </span>
            <DownloadLinks href={`/api/w/${slug}/plan/reorder/download`} />
          </div>
          {[...bySupplier].map(([supplier, lines]) => (
            <section key={supplier} className="grid gap-2" aria-label={supplier}>
              <h2 className="font-semibold">{supplier}</h2>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t('Product')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('In stock')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('Sold per day')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('Days left')}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        {t('Order about')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.product} className="border-t" data-testid="reorder-line">
                        <th scope="row" className="px-3 py-2 text-left font-normal">
                          {l.product}
                          {l.soon && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                              {t('May run out first')}
                            </span>
                          )}
                          {l.seasonal && l.lastYear !== null && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {t('Seasonal: sold {amount} in these weeks last year', {
                                amount: n.format(l.lastYear),
                              })}
                            </span>
                          )}
                        </th>
                        <td className="px-3 py-2 text-right tabular-nums">{n.format(l.onHand)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{n.format(l.perDay)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {Math.round(l.daysOfCover)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {l.suggested}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
