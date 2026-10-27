import type { ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';

/** Where a viewer (M13) would otherwise change something: says why it isn't there. */
export function ViewOnlyNote({ children }: { children: ReactNode }) {
  return (
    <Alert data-testid="view-only-note">
      You can view this business but not change it. {children}
    </Alert>
  );
}
