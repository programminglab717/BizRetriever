import { COMMON_CURRENCIES } from '@bizr/core/workspaces';
import { msg } from '@bizr/i18n/translate';
import { listPacks } from '@bizr/packs';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TryDemoButton } from '@/components/demo/try-demo-button';
import { OnboardingForm, type IndustryOption } from '@/components/onboarding/onboarding-form';
import { getT } from '@/lib/i18n';
import { requireUser } from '@/lib/session';

import { createBusiness } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Tell us about your business · BizRetriever') };
}

const COMING_SOON: IndustryOption[] = [
  {
    id: 'restaurant',
    title: msg('Restaurant, café or takeaway'),
    description: msg('Menus, covers and food costs.'),
    available: false,
  },
  {
    id: 'services',
    title: msg('Services or agency'),
    description: msg('Clients, projects and invoices.'),
    available: false,
  },
];

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  const t = await getT();
  const industries: IndustryOption[] = [
    ...listPacks().map((p) => ({
      id: p.manifest.id,
      title: t.text(p.manifest.industries_label),
      description: t.text(p.manifest.description),
      available: true,
    })),
    ...COMING_SOON.map((o) => ({ ...o, title: t(o.title), description: t(o.description) })),
  ];

  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-10">
      <main className="mx-auto grid max-w-2xl gap-8 rounded-xl border bg-card p-6 shadow-sm sm:p-10">
        <header className="grid gap-2">
          <Link href="/" className="text-sm font-semibold">
            BizRetriever
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('Hi {name}, tell us about your business', { name: user.name.split(' ')[0] ?? '' })}
          </h1>
          <p className="text-muted-foreground">{t('This helps us read your files correctly.')}</p>
        </header>
        <section
          aria-label={t('Try the demo shop')}
          className="grid gap-3 rounded-lg border border-dashed p-4 text-sm"
        >
          <p>
            <span className="font-medium">{t('Just looking?')}</span>{' '}
            <span className="text-muted-foreground">
              {t(
                'Try it with Fernwood Home & Gift, a demo gift shop with a year of messy spreadsheets. You’ll see exactly what happens with your own files.',
              )}
            </span>
          </p>
          <TryDemoButton />
        </section>
        <OnboardingForm
          action={createBusiness}
          industries={industries}
          currencies={COMMON_CURRENCIES}
        />
      </main>
    </div>
  );
}
