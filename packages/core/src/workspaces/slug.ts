import { randomBytes } from 'node:crypto';

/** URL-friendly slug from a business name plus a short random suffix, e.g. `fernwood-home-gift-k3v9`. */
export function workspaceSlug(name: string): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'business';
  const suffix = randomBytes(3).toString('hex').slice(0, 4);
  return `${base}-${suffix}`;
}
