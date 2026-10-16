'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/** Something broke while showing a page: say so plainly and offer a way on. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto grid min-h-[60dvh] max-w-md place-content-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong on our side</h1>
      <p className="text-muted-foreground">
        Nothing in your data was changed. Please try again; if it keeps happening, let us know
        {error.digest ? ` and mention code ${error.digest}` : ''}.
      </p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
