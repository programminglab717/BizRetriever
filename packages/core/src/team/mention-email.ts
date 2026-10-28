import { answer, getAppDb, insight, user, type NoteSubject } from '@bizr/db';
import { getEnv, getLogger } from '@bizr/platform';
import { and, eq, inArray } from 'drizzle-orm';

import { claim, deliver, getEmailPreferences, unsubscribeUrl } from '../insights/email';
import type { MemberWorkspace } from '../workspaces/service';

/**
 * "Sam mentioned you" (M19, ADR-069): one email per note to each person it names, unless they
 * turned these off. The note is quoted as written: it is a person's words, plain text, never
 * given to the AI. Sent once (the note is the key); a failure never stops the note being saved.
 */

const log = () => getLogger('mentions');
const QUOTE_MAX = 300;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

async function subjectOf(member: MemberWorkspace, subject: { kind: NoteSubject; id: string }) {
  const db = getAppDb();
  const base = `${getEnv().APP_URL}/w/${member.workspace.slug}`;
  if (subject.kind === 'insight') {
    const [i] = await db
      .select({ text: insight.text })
      .from(insight)
      .where(and(eq(insight.id, subject.id), eq(insight.workspaceId, member.workspace.id)));
    return { title: i?.text ?? 'an insight', link: `${base}/insights` };
  }
  const [a] = await db
    .select({ question: answer.question, conversationId: answer.conversationId })
    .from(answer)
    .where(and(eq(answer.id, subject.id), eq(answer.workspaceId, member.workspace.id)));
  return {
    title: a?.question ?? 'an answer',
    link: a ? `${base}/ask?c=${a.conversationId}` : `${base}/ask`,
  };
}

export async function sendMentionEmails(
  member: MemberWorkspace,
  authorId: string,
  noteId: string,
  subject: { kind: NoteSubject; id: string },
  body: string,
  named: readonly { id: string }[],
): Promise<void> {
  try {
    const db = getAppDb();
    const [author] = await db.select({ name: user.name }).from(user).where(eq(user.id, authorId));
    const people = await db
      .select({ id: user.id, email: user.email, verified: user.emailVerified })
      .from(user)
      .where(
        inArray(
          user.id,
          named.map((p) => p.id),
        ),
      );
    const about = await subjectOf(member, subject);
    const who = author?.name ?? 'Someone';
    const quote = body.length > QUOTE_MAX ? `${body.slice(0, QUOTE_MAX)}…` : body;
    for (const p of people) {
      // Only to addresses the person has confirmed are theirs, and only if they want these.
      if (!p.verified || !(await getEmailPreferences(member.workspace.id, p.id)).mentions) continue;
      const fresh = await claim(member.workspace.id, p.id, 'mention', [noteId]);
      if (fresh.length === 0) continue;
      const stop = unsubscribeUrl(member.workspace.id, p.id, 'mention');
      const subjectLine = `${who} mentioned you in ${member.workspace.name}`;
      await deliver(member.workspace.id, p.id, 'mention', fresh, {
        to: p.email,
        subject: subjectLine,
        text: `${who} mentioned you on “${about.title}”:\n\n${quote}\n\nSee it: ${about.link}\n\nStop these emails: ${stop}\n`,
        html: `<p>${escapeHtml(who)} mentioned you on “${escapeHtml(about.title)}”:</p><blockquote style="white-space:pre-wrap">${escapeHtml(quote)}</blockquote><p><a href="${escapeHtml(about.link)}">See it</a></p><p style="color:#59636e;font-size:12px"><a href="${escapeHtml(stop)}">Stop these emails</a></p>`,
        headers: {
          'List-Unsubscribe': `<${stop}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
    }
  } catch (err) {
    log().error({ err, workspaceId: member.workspace.id, noteId }, 'mention emails failed');
  }
}
