import type { MemberRole } from '@bizr/db';
import { msg } from '@bizr/i18n/translate';

/** What each role is called and can do, in the words Settings and the invitation use (M13). */
export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: msg('Owner'),
  member: msg('Member'),
  viewer: msg('Can view'),
};

export const ROLE_SUMMARY: Record<MemberRole, string> = {
  owner: msg('Everything, including inviting people and deleting the business.'),
  member: msg(
    'Brings in files, changes records and the dashboard, links sources, sets goals and alerts.',
  ),
  viewer: msg('Looks at everything, asks questions, downloads and leaves notes. Changes nothing.'),
};
