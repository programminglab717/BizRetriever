'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function GoogleButton({ next }: { next?: string | undefined }) {
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
      Continue with Google
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
