import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  emailDelivery,
  emailPreference,
  getAppDb,
  insight,
  user,
  workspaceMember,
  type EmailKind,
} from '@bizr/db';
import { getEnv, getLogger, sendEmail, type Email } from '@bizr/platform';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { localeFor } from '../ask/view';
import { goalProgress } from '../planning/goals';
import { goalLines } from '../planning/text';
import { currentDigest, type DigestContent } from './digest';
import type { InsightTarget } from './service';

/**
 * Insight emails (M9, ADR-057): the weekly summary and new urgent alerts, to each member with a
 * confirmed email address who hasn't turned them off. Sent after each insight run; every email is
 * recorded before it goes, so a run that repeats (worker restart, drain retry) never sends twice.
 * Without RESEND_API_KEY they are only logged (ADR-026).
 */

const log = () => getLogger('insight-email');

/** Urgent alerts go out for insights first seen this recently (not for old ones when switched on). */
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
const ALERTS_PER_EMAIL = 5;

export interface EmailPreferences {
  weeklySummary: boolean;
  urgentAlerts: boolean;
  /** Someone named them in a note (M19). */
  mentions: boolean;
}

export async function getEmailPreferences(
  workspaceId: string,
  userId: string,
): Promise<EmailPreferences> {
  const [row] = await getAppDb()
    .select()
    .from(emailPreference)
    .where(and(eq(emailPreference.workspaceId, workspaceId), eq(emailPreference.userId, userId)));
  return {
    weeklySummary: row?.weeklySummary ?? true,
    urgentAlerts: row?.urgentAlerts ?? true,
    mentions: row?.mentions ?? true,
  };
}

export async function saveEmailPreferences(
  workspaceId: string,
  userId: string,
  prefs: Partial<EmailPreferences>,
): Promise<EmailPreferences> {
  const next = { ...(await getEmailPreferences(workspaceId, userId)), ...prefs };
  await getAppDb()
    .insert(emailPreference)
    .values({ workspaceId, userId, ...next })
    .onConflictDoUpdate({
      target: [emailPreference.workspaceId, emailPreference.userId],
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

// --- One-click unsubscribe ----------------------------------------------------------------------

function unsubscribeSecret(): string {
  const env = getEnv();
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (env.NODE_ENV === 'production') throw new Error('BETTER_AUTH_SECRET is not set');
  return 'bizr-development-only-unsubscribe-secret';
}

/** A signature for a link in an email, so it works without signing in (M15: report stop links). */
export function emailLinkToken(purpose: string, ...parts: string[]): string {
  return createHmac('sha256', unsubscribeSecret())
    .update(`bizr-${purpose}:${parts.join(':')}`)
    .digest('base64url');
}

export function unsubscribeToken(workspaceId: string, userId: string, kind: EmailKind): string {
  return createHmac('sha256', unsubscribeSecret())
    .update(`bizr-unsubscribe:${workspaceId}:${userId}:${kind}`)
    .digest('base64url');
}

/** The link in every email (and its List-Unsubscribe header). Signed: no sign-in needed. */
export function unsubscribeUrl(workspaceId: string, userId: string, kind: EmailKind): string {
  const url = new URL('/api/email/unsubscribe', getEnv().APP_URL);
  url.searchParams.set('w', workspaceId);
  url.searchParams.set('u', userId);
  url.searchParams.set('k', kind);
  url.searchParams.set('t', unsubscribeToken(workspaceId, userId, kind));
  return url.toString();
}

export interface UnsubscribeRequest {
  w: string;
  u: string;
  k: string;
  t: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks the signature only; true when the link is genuine. */
export function checkUnsubscribe(r: Partial<UnsubscribeRequest>): r is UnsubscribeRequest & {
  k: 'weekly_summary' | 'urgent_alert' | 'mention';
} {
  if (!r.w || !r.u || !r.t || !UUID.test(r.w) || !UUID.test(r.u)) return false;
  if (r.k !== 'weekly_summary' && r.k !== 'urgent_alert' && r.k !== 'mention') return false;
  const want = Buffer.from(unsubscribeToken(r.w, r.u, r.k));
  const got = Buffer.from(r.t);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Turns that kind of email off. False for a link that isn't genuine. */
export async function unsubscribe(r: Partial<UnsubscribeRequest>): Promise<boolean> {
  if (!checkUnsubscribe(r)) return false;
  const [member] = await getAppDb()
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, r.w), eq(workspaceMember.userId, r.u)));
  // Someone who has left gets nothing anyway.
  if (!member) return true;
  await saveEmailPreferences(
    r.w,
    r.u,
    r.k === 'weekly_summary'
      ? { weeklySummary: false }
      : r.k === 'mention'
        ? { mentions: false }
        : { urgentAlerts: false },
  );
  return true;
}

// --- Writing the emails (pure) ------------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** `**bold**` (as insight text marks it) as plain text, or as HTML with everything else escaped. */
const plainText = (s: string) => s.replace(/\*\*/g, '');
const htmlText = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*\*/g, '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "19–25 Oct 2026" for a week whose `to` is exclusive. */
export function weekLabel(period: { from: string; to: string }): string {
  const last = new Date(`${period.to}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  const first = new Date(`${period.from}T00:00:00Z`);
  const day = (d: Date) => d.getUTCDate();
  const mon = (d: Date) => MONTHS[d.getUTCMonth()]!;
  if (first.getUTCFullYear() !== last.getUTCFullYear())
    return `${day(first)} ${mon(first)} ${first.getUTCFullYear()} – ${day(last)} ${mon(last)} ${last.getUTCFullYear()}`;
  if (first.getUTCMonth() !== last.getUTCMonth())
    return `${day(first)} ${mon(first)} – ${day(last)} ${mon(last)} ${last.getUTCFullYear()}`;
  return `${day(first)}–${day(last)} ${mon(last)} ${last.getUTCFullYear()}`;
}

export interface EmailContext {
  businessName: string;
  personName: string;
  /** The business's pages, e.g. https://app/w/fernwood. */
  baseUrl: string;
  unsubscribeUrl: string;
}

function layout(
  ctx: EmailContext,
  kind: EmailKind,
  body: { text: string[]; html: string[] },
): Pick<Email, 'text' | 'html' | 'headers'> {
  const why =
    kind === 'weekly_summary'
      ? `You get this weekly summary because you’re part of ${ctx.businessName} on BizRetriever.`
      : `You get these alerts because you’re part of ${ctx.businessName} on BizRetriever.`;
  const stop = kind === 'weekly_summary' ? 'Stop weekly summaries' : 'Stop urgent alerts';
  const settings = `${ctx.baseUrl}/insights/settings`;
  const text = [
    `Hi ${ctx.personName},`,
    '',
    ...body.text,
    '',
    '—',
    why,
    `${stop}: ${ctx.unsubscribeUrl}`,
    `Choose which emails you get: ${settings}`,
    '',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;line-height:1.5">
<p>Hi ${escapeHtml(ctx.personName)},</p>
${body.html.join('\n')}
</div>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#666666;line-height:1.5">${escapeHtml(why)}<br>
<a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#666666">${stop}</a> · <a href="${escapeHtml(settings)}" style="color:#666666">Choose which emails you get</a></p>
</body></html>`;
  return {
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${ctx.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

const button = (href: string, label: string) =>
  `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px">${escapeHtml(label)}</a></p>`;

/** The weekly summary: last week's numbers against the week before, top insights, a question. */
export function weeklySummaryEmail(
  to: string,
  digest: DigestContent,
  ctx: EmailContext,
  /** "Net sales: October 2026 so far: …", worked out by code (planning/text.ts). */
  goals: readonly string[] = [],
  /** Insights handed to this person (M13), as stored. */
  forYou: readonly string[] = [],
): Email {
  const week = weekLabel(digest.period);
  const kpiLine = (k: DigestContent['kpis'][number]) =>
    `${k.label}: ${k.value}${k.change ? ` (${k.change} on the week before)` : ''}`;
  const text: string[] = [`Here’s how ${ctx.businessName} did in the week of ${week}:`, ''];
  const html: string[] = [
    `<p>Here’s how <strong>${escapeHtml(ctx.businessName)}</strong> did in the week of ${escapeHtml(week)}:</p>`,
  ];
  if (digest.kpis.length) {
    text.push(...digest.kpis.map(kpiLine));
    html.push(
      `<ul style="padding-left:20px">${digest.kpis
        .map(
          (k) =>
            `<li><strong>${escapeHtml(k.label)}: ${escapeHtml(k.value)}</strong>${k.change ? ` (${escapeHtml(k.change)} on the week before)` : ''}</li>`,
        )
        .join('')}</ul>`,
    );
  }
  if (goals.length) {
    text.push('', 'Your goals:', ...goals.map((g) => `• ${g}`));
    html.push(
      '<p style="margin-bottom:4px">Your goals:</p>',
      `<ul style="padding-left:20px;margin-top:0">${goals.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ul>`,
    );
  }
  if (forYou.length) {
    text.push('', 'Handed to you:', ...forYou.map((t) => `• ${plainText(t)}`));
    html.push(
      '<p style="margin-bottom:4px">Handed to you:</p>',
      `<ul style="padding-left:20px;margin-top:0">${forYou.map((t) => `<li>${htmlText(t)}</li>`).join('')}</ul>`,
    );
  }
  if (digest.insights.length) {
    text.push('', 'Worth a look:', ...digest.insights.map((i) => `• ${plainText(i.text)}`));
    html.push(
      '<p style="margin-bottom:4px">Worth a look:</p>',
      `<ul style="padding-left:20px;margin-top:0">${digest.insights.map((i) => `<li>${htmlText(i.text)}</li>`).join('')}</ul>`,
    );
  }
  if (digest.question) {
    const ask = `${ctx.baseUrl}/ask?q=${encodeURIComponent(digest.question)}`;
    text.push('', `Try asking: “${digest.question}”`, ask);
    html.push(
      `<p>Try asking: <a href="${escapeHtml(ask)}">“${escapeHtml(digest.question)}”</a></p>`,
    );
  }
  text.push('', `See everything: ${ctx.baseUrl}/home`);
  html.push(button(`${ctx.baseUrl}/home`, 'Open BizRetriever'));
  return {
    to,
    subject: `${ctx.businessName}: your week of ${week}`,
    ...layout(ctx, 'weekly_summary', { text, html }),
  };
}

export interface AlertItem {
  text: string;
}

/** New urgent insights, in one email. */
export function urgentAlertEmail(
  to: string,
  items: readonly AlertItem[],
  ctx: EmailContext,
): Email {
  const shown = items.slice(0, ALERTS_PER_EMAIL);
  const more = items.length - shown.length;
  const subject =
    items.length === 1
      ? `${ctx.businessName}: ${plainText(items[0]!.text)}`.slice(0, 140)
      : `${ctx.businessName}: ${items.length} things need a look`;
  const link = `${ctx.baseUrl}/insights`;
  const text = [
    items.length === 1 ? 'This needs a look:' : 'These need a look:',
    '',
    ...shown.map((i) => `• ${plainText(i.text)}`),
    ...(more > 0 ? [`…and ${more} more.`] : []),
    '',
    `See the details: ${link}`,
  ];
  const html = [
    `<p>${items.length === 1 ? 'This needs a look:' : 'These need a look:'}</p>`,
    `<ul style="padding-left:20px">${shown.map((i) => `<li>${htmlText(i.text)}</li>`).join('')}</ul>`,
    ...(more > 0 ? [`<p>…and ${more} more.</p>`] : []),
    button(link, 'See the details'),
  ];
  return { to, subject, ...layout(ctx, 'urgent_alert', { text, html }) };
}

// --- Sending -----------------------------------------------------------------------------------

interface Recipient {
  userId: string;
  name: string;
  email: string;
  prefs: EmailPreferences;
}

async function recipients(workspaceId: string): Promise<Recipient[]> {
  const rows = await getAppDb()
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      weekly: emailPreference.weeklySummary,
      urgent: emailPreference.urgentAlerts,
      mentions: emailPreference.mentions,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .leftJoin(
      emailPreference,
      and(
        eq(emailPreference.workspaceId, workspaceMember.workspaceId),
        eq(emailPreference.userId, workspaceMember.userId),
      ),
    )
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, 'active'),
        // Only to addresses the person has confirmed are theirs.
        eq(user.emailVerified, true),
      ),
    )
    .orderBy(asc(user.createdAt));
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    prefs: {
      weeklySummary: r.weekly ?? true,
      urgentAlerts: r.urgent ?? true,
      mentions: r.mentions ?? true,
    },
  }));
}

export const MAX_EMAIL_ATTEMPTS = 3;

/**
 * Claims (kind, keys) for one person; returns the keys not sent before. One that failed (the email
 * service was down) is claimed again, up to three tries in all; one sent or being sent never is.
 */
export async function claim(
  workspaceId: string,
  userId: string,
  kind: EmailKind,
  keys: readonly string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  const rows = await getAppDb()
    .insert(emailDelivery)
    .values(keys.map((key) => ({ workspaceId, userId, kind, key })))
    .onConflictDoUpdate({
      target: [
        emailDelivery.workspaceId,
        emailDelivery.userId,
        emailDelivery.kind,
        emailDelivery.key,
      ],
      set: { status: 'sending', error: null, attempts: sql`${emailDelivery.attempts} + 1` },
      setWhere: and(
        eq(emailDelivery.status, 'failed'),
        lt(emailDelivery.attempts, MAX_EMAIL_ATTEMPTS),
      ),
    })
    .returning({ key: emailDelivery.key });
  return rows.map((r) => r.key);
}

export async function deliver(
  workspaceId: string,
  userId: string,
  kind: EmailKind,
  keys: readonly string[],
  email: Email,
): Promise<boolean> {
  const where = and(
    eq(emailDelivery.workspaceId, workspaceId),
    eq(emailDelivery.userId, userId),
    eq(emailDelivery.kind, kind),
    inArray(emailDelivery.key, [...keys]),
  );
  try {
    const how = await sendEmail(email);
    await getAppDb().update(emailDelivery).set({ status: how, sentAt: new Date() }).where(where);
    return true;
  } catch (err) {
    log().error({ err, workspaceId, kind }, 'insight email failed');
    await getAppDb()
      .update(emailDelivery)
      .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 500) : 'failed' })
      .where(where);
    return false;
  }
}

/** What's been handed to this person and is still open (M13), most important first. */
async function handedTo(workspaceId: string, userId: string): Promise<string[]> {
  const rows = await getAppDb()
    .select({ text: insight.text })
    .from(insight)
    .where(
      and(
        eq(insight.workspaceId, workspaceId),
        eq(insight.assignedTo, userId),
        inArray(insight.status, ['new', 'seen']),
      ),
    )
    .orderBy(desc(insight.score))
    .limit(10);
  return rows.map((r) => r.text);
}

/** This month's goals as sentences for the summary. A problem here never stops the email. */
async function goalText(target: InsightTarget, now: Date): Promise<string[]> {
  try {
    const style = { locale: localeFor(target.settings), currency: target.settings.currency };
    // Goals belong to the business, not to a person: read them as its owner would see them.
    const progress = await goalProgress({ ...target, role: 'owner' }, { now });
    return progress.map((g) => {
      const l = goalLines(g, style);
      return [`${g.metric.label}: ${l.soFar}`, l.heading].filter(Boolean).join(' ');
    });
  } catch (err) {
    log().warn({ err, workspaceId: target.workspace.id }, 'goals left out of the summary');
    return [];
  }
}

export interface EmailRunSummary {
  weeklySummaries: number;
  urgentAlerts: number;
}

/**
 * Sends what's due after an insight run: this week's summary (once per person per week) and any
 * urgent insight first seen in the last day (once per person per insight). Demo shops send nothing.
 */
export async function sendInsightEmails(
  target: InsightTarget,
  options: { now?: Date } = {},
): Promise<EmailRunSummary> {
  const ws = target.workspace;
  const summary: EmailRunSummary = { weeklySummaries: 0, urgentAlerts: 0 };
  if (ws.isDemo || ws.status !== 'active') return summary;
  const people = await recipients(ws.id);
  if (people.length === 0) return summary;
  const now = options.now ?? new Date();
  const baseUrl = new URL(`/w/${ws.slug}`, getEnv().APP_URL).toString();
  const ctxFor = (p: Recipient, kind: EmailKind): EmailContext => ({
    businessName: ws.name,
    personName: p.name,
    baseUrl,
    unsubscribeUrl: unsubscribeUrl(ws.id, p.userId, kind),
  });

  const urgent = await getAppDb()
    .select({ id: insight.id, text: insight.text })
    .from(insight)
    .where(
      and(
        eq(insight.workspaceId, ws.id),
        eq(insight.level, 'urgent'),
        eq(insight.status, 'new'),
        gte(insight.firstSeenAt, new Date(now.getTime() - ALERT_WINDOW_MS)),
        sql`${insight.firstSeenAt} <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(insight.score));
  const digest = await currentDigest(target, { now });
  const goals = digest ? await goalText(target, now) : [];

  for (const p of people) {
    if (p.prefs.urgentAlerts && urgent.length) {
      const fresh = await claim(
        ws.id,
        p.userId,
        'urgent_alert',
        urgent.map((u) => u.id),
      );
      const items = urgent.filter((u) => fresh.includes(u.id));
      if (
        items.length &&
        (await deliver(
          ws.id,
          p.userId,
          'urgent_alert',
          fresh,
          urgentAlertEmail(p.email, items, ctxFor(p, 'urgent_alert')),
        ))
      )
        summary.urgentAlerts += 1;
    }
    if (p.prefs.weeklySummary && digest) {
      const key = digest.content.weekOf;
      const fresh = await claim(ws.id, p.userId, 'weekly_summary', [key]);
      if (
        fresh.length &&
        (await deliver(
          ws.id,
          p.userId,
          'weekly_summary',
          fresh,
          weeklySummaryEmail(
            p.email,
            digest.content,
            ctxFor(p, 'weekly_summary'),
            goals,
            await handedTo(ws.id, p.userId),
          ),
        ))
      )
        summary.weeklySummaries += 1;
    }
  }
  if (summary.urgentAlerts || summary.weeklySummaries)
    log().info({ workspaceId: ws.id, ...summary }, 'insight emails');
  return summary;
}
