'use client';

import type { MemberList } from '@bizr/core/workspaces';
import { Copy, Loader2, UserPlus } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  cancelInvite,
  changePersonRole,
  inviteMember,
  removePerson,
} from '@/app/w/[slug]/settings/member-actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ROLE_LABEL, ROLE_SUMMARY } from '@/lib/roles';

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/**
 * People in the business. Owners invite by email (with a link to share another way), choose and
 * change what each person can do (M13), and remove people.
 */
export function Members({
  slug,
  list,
  isOwner,
  me,
}: {
  slug: string;
  list: MemberList;
  isOwner: boolean;
  me: string;
}) {
  const [email, setEmail] = useState('');
  const [as, setAs] = useState<'member' | 'viewer'>('member');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const invite = () =>
    startTransition(async () => {
      setError(null);
      setCopied(false);
      const r = await inviteMember(slug, email, as);
      if (!r.ok) return setError(r.error);
      setSent({ email, ...r.data });
      setEmail('');
    });

  return (
    <div className="grid gap-4 text-sm">
      <ul className="grid divide-y" data-testid="member-list">
        {list.members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{m.name}</span>{' '}
              <span className="text-muted-foreground">{m.email}</span>
            </span>
            <span className="flex items-center gap-2">
              {isOwner && m.userId !== me && m.role !== 'owner' ? (
                <Select
                  aria-label={`What ${m.name} can do`}
                  className="h-9 w-auto"
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => {
                    const to = e.target.value;
                    startTransition(async () => {
                      setError(null);
                      const r = await changePersonRole(slug, m.userId, to);
                      if (!r.ok) setError(r.error);
                    });
                  }}
                >
                  <option value="member">{ROLE_LABEL.member}</option>
                  <option value="viewer">{ROLE_LABEL.viewer}</option>
                </Select>
              ) : (
                <span className="text-muted-foreground" data-testid="member-role">
                  {ROLE_LABEL[m.role]}
                </span>
              )}
              {isOwner && m.userId !== me && m.role !== 'owner' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await removePerson(slug, m.userId);
                      if (!r.ok) setError(r.error);
                    })
                  }
                >
                  Remove
                </Button>
              ) : null}
            </span>
          </li>
        ))}
        {list.invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-muted-foreground">
              {i.email} · {ROLE_LABEL[i.role].toLowerCase()} · invited {when.format(i.sentAt)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await cancelInvite(slug, i.id);
                  if (!r.ok) setError(r.error);
                })
              }
            >
              Cancel invitation
            </Button>
          </li>
        ))}
      </ul>

      {isOwner ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) invite();
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Email of the person to invite"
            className="h-9 min-w-56 flex-1 rounded-md border bg-background px-3 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Select
            aria-label="What they can do"
            className="h-9 w-auto"
            value={as}
            onChange={(e) => setAs(e.target.value === 'viewer' ? 'viewer' : 'member')}
          >
            <option value="member">{ROLE_LABEL.member}</option>
            <option value="viewer">{ROLE_LABEL.viewer}</option>
          </Select>
          <Button type="submit" disabled={pending || !email.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Invite
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground">Only the owner can invite people.</p>
      )}

      {sent ? (
        <div className="grid gap-2 rounded-lg bg-muted/50 p-3" data-testid="invite-sent">
          <p>
            {sent.emailed
              ? `We emailed an invitation to ${sent.email}.`
              : `Invitation ready for ${sent.email}.`}{' '}
            You can also send them this link (it works for 7 days, for that email only):
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={sent.link}
              aria-label="Invitation link"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(sent.link).then(() => setCopied(true));
              }}
            >
              <Copy /> {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <dl className="grid gap-1 text-muted-foreground" aria-label="What each role can do">
        {(['owner', 'member', 'viewer'] as const).map((r) => (
          <div key={r}>
            <dt className="inline font-medium text-foreground">{ROLE_LABEL[r]}:</dt>{' '}
            <dd className="inline">{ROLE_SUMMARY[r]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
