import { getAppDb, userPreference, type Language } from '@bizr/db';
import { eq, inArray } from 'drizzle-orm';

/**
 * Languages (M20, ADR-071): a business has a default; each person may choose their own, which
 * follows them across businesses. Screens, emails and PDFs use the reader's language.
 */

export async function userLanguage(userId: string): Promise<Language | null> {
  const [row] = await getAppDb()
    .select({ language: userPreference.language })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return row?.language ?? null;
}

/** `null` means "the business's language". */
export async function setUserLanguage(userId: string, language: Language | null): Promise<void> {
  await getAppDb()
    .insert(userPreference)
    .values({ userId, language })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { language, updatedAt: new Date() },
    });
}

/** What a person reads in a business: their own choice, else the business's. */
export function readerLanguage(
  own: Language | null | undefined,
  business: { language: Language } | null | undefined,
): Language {
  return own ?? business?.language ?? 'en';
}

/** Several people at once (emails): user id → their own choice, if they made one. */
export async function userLanguages(userIds: readonly string[]): Promise<Map<string, Language>> {
  if (userIds.length === 0) return new Map();
  const rows = await getAppDb()
    .select({ userId: userPreference.userId, language: userPreference.language })
    .from(userPreference)
    .where(inArray(userPreference.userId, [...userIds]));
  return new Map(rows.flatMap((r) => (r.language ? [[r.userId, r.language] as const] : [])));
}
