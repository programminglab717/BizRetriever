/** Grey placeholder blocks while a page's numbers are worked out. */
export function PageSkeleton({
  label,
  blocks = [24, 36, 36, 36],
}: {
  label: string;
  blocks?: number[];
}) {
  return (
    <div className="grid grid-cols-1 gap-6" role="status" aria-label={label}>
      <div className="h-8 w-56 animate-pulse rounded bg-muted" />
      {blocks.map((h, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border bg-muted/40"
          style={{ height: `${h * 0.25}rem` }}
        />
      ))}
    </div>
  );
}
