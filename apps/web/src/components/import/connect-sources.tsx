import { Cable } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getT } from '@/lib/i18n';

/**
 * More sources (M18): each shown only when it's switched on. The accounting tools and Square sign
 * in on their own site; WooCommerce asks for the store's address and approves on the store.
 */
export async function ConnectSources({
  slug,
  providers,
  woo,
  badStore,
}: {
  slug: string;
  providers: { kind: string; label: string }[];
  woo: boolean;
  badStore: boolean;
}) {
  if (providers.length === 0 && !woo) return null;
  const t = await getT();
  return (
    <section aria-labelledby="sources-heading" className="grid gap-3 rounded-xl border p-4">
      <div className="grid gap-1">
        <h2 id="sources-heading" className="flex items-center gap-2 font-medium">
          <Cable className="size-4" aria-hidden /> {t('Or connect the tools you use')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'We read your sales, customers, products and payments, and check for changes every day. We never change anything there.',
          )}
        </p>
      </div>
      {providers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => (
            <Button key={p.kind} asChild variant="outline">
              <a href={`/api/w/${slug}/connect/${p.kind}`}>
                {t('Connect {source}', { source: p.label })}
              </a>
            </Button>
          ))}
        </div>
      )}
      {woo && (
        <form
          method="get"
          action={`/api/w/${slug}/connect/woocommerce`}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="woo-store" className="sr-only">
            {t('Your WooCommerce store’s web address')}
          </label>
          <Input
            id="woo-store"
            name="store"
            required
            placeholder={t('https://your-store.com')}
            autoComplete="off"
            aria-invalid={badStore || undefined}
          />
          <Button type="submit">{t('Connect WooCommerce')}</Button>
        </form>
      )}
      {badStore && (
        <p role="alert" className="text-sm text-destructive">
          {t(
            'Please enter your store’s web address, like https://your-store.com. It has to start with https.',
          )}
        </p>
      )}
    </section>
  );
}
