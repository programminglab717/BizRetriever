'use client';

import { useActionState } from 'react';

import { tryDemoShop, type DemoState } from '@/app/demo/actions';
import { Button } from '@/components/ui/button';

/** Starts (or restarts) the demo shop's import. */
export function TryDemoButton({
  label = 'Try the demo shop',
  variant = 'outline',
}: {
  label?: string;
  variant?: 'outline' | 'default' | 'secondary';
}) {
  const [state, action, pending] = useActionState<DemoState, FormData>(tryDemoShop, {});
  return (
    <form action={action} className="grid gap-2">
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? 'Setting up the demo shop…' : label}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
