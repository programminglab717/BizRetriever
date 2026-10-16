import { COMMON_CURRENCIES } from '@bizr/core/workspaces';
import { listPacks } from '@bizr/packs';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TryDemoButton } from '@/components/demo/try-demo-button';
import { OnboardingForm, type IndustryOption } from '@/components/onboarding/onboarding-form';
import { requireUser } from '@/lib/session';

import { createBusiness } from './actions';

export const metadata: Metadata = { title: 'Tell us about your business · BizRetriever' };

const COMING_SOON: IndustryOption[] = [
  {
    id: 'restaurant',
    title: 'Restaurant, café or takeaway',
    description: 'Menus, covers and food costs.',
    available: false,
  },
  {
    id: 'services',
    title: 'Services or agency',
    description: 'Clients, projects and invoices.',
    available: false,
  },
];

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  const industries: IndustryOption[] = [
    ...listPacks().map((p) => ({
      id: p.manifest.id,
      title: p.manifest.industries_label,
      description: p.manifest.description,
      available: true,
    })),
    ...COMING_SOON,
  ];

  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-10">
      <main className="mx-auto grid max-w-2xl gap-8 rounded-xl border bg-card p-6 shadow-sm sm:p-10">
        <header className="grid gap-2">
          <Link href="/" className="text-sm font-semibold">
            BizRetriever
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hi {user.name.split(' ')[0]}, tell us about your business
          </h1>
          <p className="text-muted-foreground">This helps us read your files correctly.</p>
        </header>
        <section
          aria-label="Try the demo shop"
          className="grid gap-3 rounded-lg border border-dashed p-4 text-sm"
        >
          <p>
            <span className="font-medium">Just looking?</span>{' '}
            <span className="text-muted-foreground">
              Try it with Fernwood Home & Gift, a demo gift shop with a year of messy spreadsheets.
              You’ll see exactly what happens with your own files.
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
