import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/shell/page-header';
import { SignOutButton } from '@/components/shell/sign-out-button';
import { requireWorkspace } from '@/lib/session';

export default async function MorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user } = await requireWorkspace(slug);
  return (
    <div className="grid gap-6">
      <PageHeader title="More" />
      <ul className="divide-y rounded-xl border">
        <li>
          <Link href={`/w/${slug}/settings`} className="flex items-center justify-between p-4">
            <span>Settings</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
        <li>
          <Link href={`/w/${slug}/glossary`} className="flex items-center justify-between p-4">
            <span>What we track</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
        <li className="flex items-center justify-between p-4 text-muted-foreground">
          <span>Change history</span>
          <span className="text-xs">Coming soon</span>
        </li>
      </ul>
      <div className="grid gap-1 text-sm">
        <p className="text-muted-foreground">Signed in as {user.email}</p>
        <SignOutButton className="justify-self-start px-0" />
      </div>
    </div>
  );
}
