import { dateOrders } from '@bizr/db';
import { z } from 'zod';

/** Currencies offered at onboarding (any ISO 4217 code is valid; these are the common ones). */
export const COMMON_CURRENCIES = [
  { code: 'USD', label: 'US dollar ($)' },
  { code: 'GBP', label: 'British pound (£)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'CAD', label: 'Canadian dollar (CA$)' },
  { code: 'AUD', label: 'Australian dollar (A$)' },
  { code: 'NZD', label: 'New Zealand dollar (NZ$)' },
  { code: 'INR', label: 'Indian rupee (₹)' },
  { code: 'PKR', label: 'Pakistani rupee (Rs)' },
  { code: 'AED', label: 'UAE dirham (AED)' },
  { code: 'SAR', label: 'Saudi riyal (SAR)' },
  { code: 'SGD', label: 'Singapore dollar (S$)' },
  { code: 'ZAR', label: 'South African rand (R)' },
  { code: 'NGN', label: 'Nigerian naira (₦)' },
  { code: 'KES', label: 'Kenyan shilling (KSh)' },
  { code: 'PHP', label: 'Philippine peso (₱)' },
  { code: 'MYR', label: 'Malaysian ringgit (RM)' },
  { code: 'BDT', label: 'Bangladeshi taka (৳)' },
  { code: 'MXN', label: 'Mexican peso (MX$)' },
  { code: 'BRL', label: 'Brazilian real (R$)' },
  { code: 'JPY', label: 'Japanese yen (¥)' },
] as const;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const businessSettingsSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency'),
  timezone: z.string().refine(isValidTimezone, 'Choose a time zone'),
  dateOrder: z.enum(dateOrders, { message: 'Tell us how you write dates' }),
});

export const newWorkspaceSchema = businessSettingsSchema.extend({
  name: z
    .string()
    .trim()
    .min(2, 'Your business name needs at least 2 characters')
    .max(80, 'Please keep your business name under 80 characters'),
  packId: z.string().regex(/^[a-z0-9_]+$/, 'Choose what you sell'),
});

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type NewWorkspaceInput = z.infer<typeof newWorkspaceSchema>;
