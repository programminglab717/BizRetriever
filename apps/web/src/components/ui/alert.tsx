import type * as React from 'react';

import { cn } from '@/lib/utils';

/** Inline message. `tone="error"` is announced to screen readers immediately. */
export function Alert({
  tone = 'info',
  className,
  ...props
}: React.ComponentProps<'div'> & { tone?: 'info' | 'error' | 'success' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-destructive/40 bg-destructive/5 text-destructive',
        tone === 'success' && 'border-emerald-600/30 bg-emerald-50 text-emerald-900',
        tone === 'info' && 'bg-muted text-foreground',
        className,
      )}
      {...props}
    />
  );
}
