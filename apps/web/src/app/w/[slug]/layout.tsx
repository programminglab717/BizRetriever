import Link from 'next/link';
import type { ReactNode } from 'react';

import { canChange } from '@bizr/core/workspaces';

import { CanChangeProvider } from '@/components/shell/can-change';
import { BottomNav, SidebarNav } from '@/components/shell/nav';
import { SignOutButton } from '@/components/shell/sign-out-button';
import { requireWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900',
        className,
      )}
    >
      Demo
    </span>
  );
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { workspace, user, role } = await requireWorkspace(slug);
  const editor = canChange(role);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r bg-muted/30 md:flex md:min-h-dvh md:flex-col md:gap-6 md:p-4">
        <Link href={`/w/${slug}/home`} className="px-3 text-sm font-semibold">
          BizRetriever
        </Link>
        <div className="px-3">
          <p className="text-xs text-muted-foreground">Business</p>
          <p className="truncate font-medium" data-testid="workspace-name">
            {workspace.name}
          </p>
          {workspace.isDemo && <DemoBadge />}
          {!editor && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="view-only">
              You can view this business
            </p>
          )}
        </div>
        <SidebarNav slug={slug} />
        <div className="mt-auto grid gap-1 px-3 text-sm">
          <p className="truncate text-muted-foreground">{user.email}</p>
          <SignOutButton className="justify-start px-0" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <span className="truncate font-semibold">{workspace.name}</span>
          {workspace.isDemo && <DemoBadge className="ml-2" />}
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10 md:pt-10">
          <CanChangeProvider value={editor}>{children}</CanChangeProvider>
        </main>
      </div>
      <BottomNav slug={slug} />
    </div>
  );
}
