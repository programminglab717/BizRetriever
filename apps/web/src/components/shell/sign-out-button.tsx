'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useT } from '@/components/i18n/provider';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function SignOutButton({ className }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      disabled={pending}
      onClick={() => {
        setPending(true);
        void authClient.signOut().then(() => {
          router.push('/');
          router.refresh();
        });
      }}
    >
      {t('Sign out')}
    </Button>
  );
}
