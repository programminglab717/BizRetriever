import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { BusinessesSection } from '@/components/demo/businesses-section';
import { PageHeader } from '@/components/shell/page-header';
import { SignOutButton } from '@/components/shell/sign-out-button';
import { getT } from '@/lib/i18n';
import { requireWorkspace } from '@/lib/session';

export default async function MorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user } = await requireWorkspace(slug);
  const t = await getT();
  return (
    <div className="grid gap-6">
      <PageHeader title={t('More')} />
      <ul className="divide-y rounded-xl border">
        <li>
          <Link href={`/w/${slug}/settings`} className="flex items-center justify-between p-4">
            <span>{t('Settings')}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
        <li>
          <Link href={`/w/${slug}/glossary`} className="flex items-center justify-between p-4">
            <span>{t('What we track')}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
        <li>
          <Link href={`/w/${slug}/plan`} className="flex items-center justify-between p-4">
            <span>{t('Plan ahead')}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
        <li>
          <Link href={`/w/${slug}/insights`} className="flex items-center justify-between p-4">
            <span>{t('All insights')}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
        <li>
          <Link
            href={`/w/${slug}/insights/settings`}
            className="flex items-center justify-between p-4"
          >
            <span>{t('Alert settings')}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
        <li>
          <Link href={`/w/${slug}/history`} className="flex items-center justify-between p-4">
            <span>{t('Change history')}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      </ul>
      <BusinessesSection userId={user.id} currentSlug={slug} />
      <div className="grid gap-1 text-sm">
        <p className="text-muted-foreground">{t('Signed in as {email}', { email: user.email })}</p>
        <SignOutButton className="justify-self-start px-0" />
      </div>
    </div>
  );
}
