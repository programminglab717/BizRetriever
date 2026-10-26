import { Store } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** "Connect your Shopify store": a plain form, so the browser goes to Shopify to approve. */
export function ConnectShopifyForm({ slug, badShop }: { slug: string; badShop: boolean }) {
  return (
    <section aria-labelledby="shopify-heading" className="grid gap-3 rounded-xl border p-4">
      <div className="grid gap-1">
        <h2 id="shopify-heading" className="flex items-center gap-2 font-medium">
          <Store className="size-4" aria-hidden /> Or connect your Shopify store
        </h2>
        <p className="text-sm text-muted-foreground">
          We read your products, stock, customers and orders, and check for changes every day. We
          never change anything in your store.
        </p>
      </div>
      <form
        method="get"
        action={`/api/w/${slug}/connect/shopify`}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="shopify-shop" className="sr-only">
          Your Shopify store address
        </label>
        <Input
          id="shopify-shop"
          name="shop"
          required
          placeholder="your-store.myshopify.com"
          autoComplete="off"
          aria-invalid={badShop || undefined}
        />
        <Button type="submit">Connect Shopify</Button>
      </form>
      {badShop && (
        <p role="alert" className="text-sm text-destructive">
          Please enter your store’s Shopify address, like your-store.myshopify.com. You’ll find it
          in Shopify under Settings → Domains.
        </p>
      )}
    </section>
  );
}
