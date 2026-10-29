import { answer, getAppDb, insight, user, type NoteSubject } from '@bizr/db';
import { translator } from '@bizr/i18n';
import { getEnv, getLogger } from '@bizr/platform';
import { and, eq, inArray } from 'drizzle-orm';

import { claim, deliver, getEmailPreferences, unsubscribeUrl } from '../insights/email';
import { localizeInsights } from '../insights/localize';
import { readerLanguage, userLanguages } from '../workspaces/language';
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

async function subjectOf(
  member: MemberWorkspace,
  subject: { kind: NoteSubject; id: string },
  lang: 'en' | 'es',
) {
  const t = translator(lang);
  const db = getAppDb();
  const base = `${getEnv().APP_URL}/w/${member.workspace.slug}`;
  if (subject.kind === 'insight') {
    const [i] = await db
      .select({
        id: insight.id,
        ruleId: insight.ruleId,
        category: insight.category,
        level: insight.level,
        headline: insight.headline,
        context: insight.context,
        text: insight.text,
        action: insight.action,
        status: insight.status,
        firstSeenAt: insight.firstSeenAt,
        lastSeenAt: insight.lastSeenAt,
        assignedTo: insight.assignedTo,
        facts: insight.facts,
      })
      .from(insight)
      .where(and(eq(insight.id, subject.id), eq(insight.workspaceId, member.workspace.id)));
    const shown = i ? localizeInsights(member, [i], lang)[0]!.text : t('an insight');
    return { title: shown, link: `${base}/insights` };
  }
  const [a] = await db
    .select({ question: answer.question, conversationId: answer.conversationId })
    .from(answer)
    .where(and(eq(answer.id, subject.id), eq(answer.workspaceId, member.workspace.id)));
  return {
    title: a?.question ?? t('an answer'),
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
    const quote = body.length > QUOTE_MAX ? `${body.slice(0, QUOTE_MAX)}…` : body;
    const langs = await userLanguages(people.map((p) => p.id));
    for (const p of people) {
      // In the reader's language (M20).
      const lang = readerLanguage(langs.get(p.id), member.settings);
      const t = translator(lang);
      const about = await subjectOf(member, subject, lang);
      const who = author?.name ?? t('Someone');
      // Only to addresses the person has confirmed are theirs, and only if they want these.
      if (!p.verified || !(await getEmailPreferences(member.workspace.id, p.id)).mentions) continue;
      const fresh = await claim(member.workspace.id, p.id, 'mention', [noteId]);
      if (fresh.length === 0) continue;
      const stop = unsubscribeUrl(member.workspace.id, p.id, 'mention');
      const subjectLine = t('{who} mentioned you in {business}', {
        who,
        business: member.workspace.name,
      });
      const lead = t('{who} mentioned you on “{title}”:', { who, title: about.title });
      const seeIt = t('See it');
      const stopThese = t('Stop these emails');
      await deliver(member.workspace.id, p.id, 'mention', fresh, {
        to: p.email,
        subject: subjectLine,
        text: `${lead}\n\n${quote}\n\n${seeIt}: ${about.link}\n\n${stopThese}: ${stop}\n`,
        html: `<p>${escapeHtml(lead)}</p><blockquote style="white-space:pre-wrap">${escapeHtml(quote)}</blockquote><p><a href="${escapeHtml(about.link)}">${escapeHtml(seeIt)}</a></p><p style="color:#59636e;font-size:12px"><a href="${escapeHtml(stop)}">${escapeHtml(stopThese)}</a></p>`,
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
