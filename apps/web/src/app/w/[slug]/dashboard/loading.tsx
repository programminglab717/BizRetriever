import { getT } from '@/lib/i18n';

/** Skeleton tiles while the dashboard's numbers are worked out. */
export default async function DashboardLoading() {
  const t = await getT();
  const sizes = [3, 3, 3, 3, 8, 4, 6, 6];
  return (
    <div className="grid gap-6" role="status" aria-label={t('Loading your dashboard')}>
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 md:grid-cols-12">
        {sizes.map((w, i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-xl border bg-muted/40 md:[grid-column:span_var(--w)/span_var(--w)]"
            style={{ ['--w' as string]: String(w) }}
          />
        ))}
      </div>
    </div>
  );
}
