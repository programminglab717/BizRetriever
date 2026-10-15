import type { ReactNode } from 'react';

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="grid gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
    </header>
  );
}

/** Friendly placeholder for features that arrive in a later update. */
export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 rounded-xl border border-dashed p-6 text-sm">
      <h2 className="font-medium">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}
