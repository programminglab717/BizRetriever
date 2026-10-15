'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

export function SignOutButton({ className }: { className?: string }) {
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
      Sign out
    </Button>
  );
}
