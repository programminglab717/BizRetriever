import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { getT } from '@/lib/i18n';

/** Where a viewer (M13) would otherwise change something: says why it isn't there. */
export async function ViewOnlyNote({ children }: { children: ReactNode }) {
  const t = await getT();
  return (
    <Alert data-testid="view-only-note">
      {t('You can view this business but not change it.')} {children}
    </Alert>
  );
}
