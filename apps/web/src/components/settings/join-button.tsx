'use client';

import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { joinBusiness } from '@/app/invite/[token]/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function JoinButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-3">
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await joinBusiness(token);
            if (r.error) setError(r.error);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : null} Join
      </Button>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
