import type { MemberRole } from '@bizr/db';

/** What each role is called and can do, in the words Settings and the invitation use (M13). */
export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Can view',
};

export const ROLE_SUMMARY: Record<MemberRole, string> = {
  owner: 'Everything, including inviting people and deleting the business.',
  member:
    'Brings in files, changes records and the dashboard, links sources, sets goals and alerts.',
  viewer: 'Looks at everything, asks questions, downloads and leaves notes. Changes nothing.',
};
