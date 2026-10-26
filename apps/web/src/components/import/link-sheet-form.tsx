'use client';

import { Link2 } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { linkSheetAction } from '@/app/w/[slug]/data/sources/actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** "Link a Google Sheet": paste its share link; it then keeps your data up to date by itself. */
export function LinkSheetForm({ slug }: { slug: string }) {
  const router = useRouter();
  const inputId = useId();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await linkSheetAction(slug, link);
      if (!r.ok) return setError(r.error);
      router.push(`/w/${slug}/data/import/${r.value.runId}` as Route);
    });
  return (
    <section aria-labelledby={`${inputId}-heading`} className="grid gap-3 rounded-xl border p-4">
      <div className="grid gap-1">
        <h2 id={`${inputId}-heading`} className="flex items-center gap-2 font-medium">
          <Link2 className="size-4" aria-hidden /> Or link a Google Sheet
        </h2>
        <p className="text-sm text-muted-foreground">
          Keep working in your sheet. We check it every day and bring in what changed. In Google
          Sheets, choose Share → “Anyone with the link” → Viewer, then copy the link.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) submit();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Google Sheets link
        </label>
        <Input
          id={inputId}
          type="url"
          inputMode="url"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !link.trim()}>
          {pending ? 'Reading your sheet…' : 'Link this sheet'}
        </Button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
    </section>
  );
}
