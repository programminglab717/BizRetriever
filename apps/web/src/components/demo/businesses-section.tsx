import { listUserWorkspaces } from '@bizr/core/workspaces';
import { Check } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';

import { TryDemoButton } from '@/components/demo/try-demo-button';

/** Switch between businesses, add one, and start or reset the demo shop. */
export async function BusinessesSection({
  userId,
  currentSlug,
}: {
  userId: string;
  currentSlug: string;
}) {
  const mine = await listUserWorkspaces(userId);
  const hasDemo = mine.some((m) => m.workspace.isDemo);
  return (
    <section aria-labelledby="businesses" className="grid gap-3">
      <h2 id="businesses" className="text-lg font-semibold">
        Your businesses
      </h2>
      <ul className="divide-y rounded-xl border">
        {mine.map(({ workspace }) => (
          <li key={workspace.id}>
            <Link
              href={`/w/${workspace.slug}/home` as Route}
              aria-current={workspace.slug === currentSlug ? 'page' : undefined}
              className="flex items-center justify-between gap-3 p-4"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{workspace.name}</span>
                {workspace.isDemo && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    Demo
                  </span>
                )}
              </span>
              {workspace.slug === currentSlug && (
                <Check className="size-4 text-muted-foreground" aria-label="You’re here" />
              )}
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-start gap-3">
        <Link
          href="/onboarding"
          className="inline-flex h-9 items-center text-sm text-primary hover:underline"
        >
          Add another business
        </Link>
        <TryDemoButton label={hasDemo ? 'Start the demo shop again' : 'Try the demo shop'} />
      </div>
      {hasDemo && (
        <p className="text-sm text-muted-foreground">
          Starting again replaces the demo shop with a fresh copy dated today.
        </p>
      )}
    </section>
  );
}
