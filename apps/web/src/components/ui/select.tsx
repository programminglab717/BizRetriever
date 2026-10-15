import type * as React from 'react';

import { cn } from '@/lib/utils';

/** Native select: accessible, works well on phones, no extra dependency. */
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none md:text-sm',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}
