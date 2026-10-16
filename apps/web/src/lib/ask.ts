import 'server-only';

import { localeFor, type ViewOptions } from '@bizr/core/ask';
import type { MemberWorkspace } from '@bizr/core/workspaces';
import { getPack } from '@bizr/packs';

/** How answers are formatted for a workspace (currency, number style, fiscal year). */
export function viewOptions(member: MemberWorkspace): ViewOptions {
  return {
    pack: getPack(member.workspace.packId),
    locale: localeFor(member.settings),
    currency: member.settings.currency,
    fiscalYearStartMonth: member.settings.fiscalYearStartMonth,
  };
}
