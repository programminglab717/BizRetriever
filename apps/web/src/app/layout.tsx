import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { I18nProvider } from '@/components/i18n/provider';
import { clientI18n } from '@/lib/i18n';

import './globals.css';

export const metadata: Metadata = {
  title: 'BizRetriever',
  // i18n-skip: static metadata
  description: 'Your business data, explained in plain language.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const i18n = await clientI18n();
  return (
    <html lang={i18n.lang}>
      <body className="min-h-dvh">
        <I18nProvider {...i18n}>{children}</I18nProvider>
      </body>
    </html>
  );
}
