import 'server-only';

import { localeFor, type ViewOptions } from '@bizr/core/ask';
import type { MemberWorkspace } from '@bizr/core/workspaces';
import type { Language } from '@bizr/i18n';
import { getPack } from '@bizr/packs';

/** How answers are formatted for a workspace (currency, number style, fiscal year). */
export function viewOptions(member: MemberWorkspace, lang: Language = 'en'): ViewOptions {
  return {
    pack: getPack(member.workspace.packId),
    locale: localeFor(member.settings, lang),
    currency: member.settings.currency,
    fiscalYearStartMonth: member.settings.fiscalYearStartMonth,
  };
}
