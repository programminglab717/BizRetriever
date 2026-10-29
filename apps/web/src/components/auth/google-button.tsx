'use client';

import { useState } from 'react';

import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function GoogleButton({ next }: { next?: string | undefined }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void authClient.signIn.social({ provider: 'google', callbackURL: next ?? '/' });
      }}
    >
      {t('Continue with Google')}
    </Button>
  );
}

export function OrDivider() {
  const t = useT();
  return (
    <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {t('or')}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
