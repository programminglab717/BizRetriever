import { z } from 'zod';

/** Pack manifest (`pack.yaml`), VERTICAL_PACKS.md §1.2. Other pack files get schemas as they land. */
export const packManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and _ only'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'semver, e.g. 1.0.0'),
    name: z.string().min(1),
    description: z.string().min(1),
    industries_label: z.string().min(1),
    locale_defaults: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code'),
        date_order: z.enum(['DMY', 'MDY', 'YMD']),
      })
      .strict(),
    requires_core: z.string().min(1),
    primary_time_entity: z.string().regex(/^[a-z0-9_]+$/),
  })
  .strict();

export type PackManifest = z.infer<typeof packManifestSchema>;
