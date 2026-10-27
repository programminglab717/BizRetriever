import { timingSafeEqual } from 'node:crypto';

import { answer, getAppDb, reportSchedule, user, workspace, type ReportSchedule } from '@bizr/db';
import { getPack } from '@bizr/packs';
import { getEnv, getLogger } from '@bizr/platform';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { toAnswerData } from '../ask/answer';
import { interpretationSchema, periodOf, toQuerySpec } from '../ask/interpretation';
import { periodLabel } from '../ask/time';
import { kpiViews, localeFor, tableView } from '../ask/view';
import { fileNameFor } from '../export/sheet';
import { dashboardPdf } from '../export/service';
import { toPdf } from '../export/pdf';
import { claim, deliver, emailLinkToken } from '../insights/email';
import { compileContext, runQuery } from '../semantic/service';
import { getMemberWorkspace, type MemberWorkspace } from '../workspaces/service';

/**
 * Scheduled reports (M15, ADR-065): the dashboard or one question, emailed as a PDF every week or
 * month to the person who asked for it. Each report is worked out fresh with that day's data, by
 * the same code as the screens, and recorded in the email ledger so a period is sent once (failed
 * sends are tried again, up to three times).
 */

export class ReportError extends Error {}

export const MAX_REPORTS_PER_PERSON = 10;

const inputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('dashboard'),
      cadence: z.enum(['weekly', 'monthly']),
      day: z.number().int().min(1).max(28),
    })
    .strict(),
  z
    .object({
      kind: z.literal('question'),
      answerId: z.uuid(),
      cadence: z.enum(['weekly', 'monthly']),
      day: z.number().int().min(1).max(28),
    })
    .strict(),
]);
export type ReportInput = z.input<typeof inputSchema>;

export interface ReportView {
  id: string;
  kind: 'dashboard' | 'question';
  title: string;
  cadence: 'weekly' | 'monthly';
  day: number;
  /** "Every Monday", "On the 1st of each month". */
  when: string;
  paused: boolean;
  lastSentAt: string | null;
  lastError: string | null;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function whenText(cadence: 'weekly' | 'monthly', day: number): string {
  return cadence === 'weekly'
    ? `Every ${WEEKDAYS[day - 1] ?? 'Monday'}`
    : `On the ${ordinal(day)} of each month`;
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The period a report belongs to on `today` (the business's own date), and the day in it the report
 * is due: a week runs Monday to Sunday ("2026-W44"), a month is the calendar month ("2026-11").
 */
export function reportPeriod(
  cadence: 'weekly' | 'monthly',
  day: number,
  today: string,
): { key: string; due: string } {
  if (cadence === 'monthly')
    return { key: today.slice(0, 7), due: `${today.slice(0, 8)}${String(day).padStart(2, '0')}` };
  const iso = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const monday = addDays(today, 1 - iso);
  // ISO week number of that Monday's Thursday.
  const thursday = new Date(`${addDays(monday, 3)}T00:00:00Z`);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
  return {
    key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
    due: addDays(monday, Math.min(7, Math.max(1, day)) - 1),
  };
}

function view(r: ReportSchedule): ReportView {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    cadence: r.cadence,
    day: r.day,
    when: whenText(r.cadence, r.day),
    paused: r.paused,
    lastSentAt: r.lastSentAt?.toISOString() ?? null,
    lastError: r.lastError,
  };
}

/** Sets a report up for the person asking (anyone in the business, viewers too). */
export async function createReport(
  member: MemberWorkspace,
  userId: string,
  raw: ReportInput,
  now = new Date(),
): Promise<ReportView> {
  const input = inputSchema.safeParse(raw);
  if (!input.success) throw new ReportError('Please choose how often to send it.');
  const { cadence, day } = input.data;
  if (cadence === 'weekly' && day > 7) throw new ReportError('Please choose a day of the week.');
  const db = getAppDb();
  const mine = await db
    .select({ id: reportSchedule.id })
    .from(reportSchedule)
    .where(
      and(eq(reportSchedule.workspaceId, member.workspace.id), eq(reportSchedule.userId, userId)),
    );
  if (mine.length >= MAX_REPORTS_PER_PERSON)
    throw new ReportError(
      `You can have up to ${MAX_REPORTS_PER_PERSON} reports. Delete one first.`,
    );

  let title = `${member.workspace.name} dashboard`;
  if (input.data.kind === 'question') {
    const [a] = await db
      .select({ question: answer.question, interpretation: answer.interpretation })
      .from(answer)
      .where(and(eq(answer.id, input.data.answerId), eq(answer.workspaceId, member.workspace.id)));
    const i = a ? interpretationSchema.safeParse(a.interpretation) : undefined;
    if (!a || !i?.success || i.data.kind !== 'query')
      throw new ReportError('Only answers with numbers can be sent as a report.');
    title = a.question.slice(0, 120);
  }
  // Already past this period's day: the first one goes next period, not straight away.
  const today = compileContext(member, now).today;
  const period = reportPeriod(cadence, day, today);
  const [row] = await db
    .insert(reportSchedule)
    .values({
      workspaceId: member.workspace.id,
      userId,
      kind: input.data.kind,
      answerId: input.data.kind === 'question' ? input.data.answerId : null,
      title,
      cadence,
      day,
      lastPeriod: today >= period.due ? period.key : null,
    })
    .returning();
  return view(row!);
}

export async function listReports(member: MemberWorkspace, userId: string): Promise<ReportView[]> {
  const rows = await getAppDb()
    .select()
    .from(reportSchedule)
    .where(
      and(eq(reportSchedule.workspaceId, member.workspace.id), eq(reportSchedule.userId, userId)),
    )
    .orderBy(asc(reportSchedule.createdAt));
  return rows.map(view);
}

/** Pause, resume or delete one of your own reports. */
export async function updateReport(
  member: MemberWorkspace,
  userId: string,
  id: string,
  change: { paused: boolean } | 'delete',
): Promise<void> {
  const db = getAppDb();
  const mine = and(
    eq(reportSchedule.id, id),
    eq(reportSchedule.workspaceId, member.workspace.id),
    eq(reportSchedule.userId, userId),
  );
  const r =
    change === 'delete'
      ? await db.delete(reportSchedule).where(mine).returning({ id: reportSchedule.id })
      : await db
          .update(reportSchedule)
          .set({ paused: change.paused })
          .where(mine)
          .returning({ id: reportSchedule.id });
  if (r.length === 0) throw new ReportError('That report isn’t there any more.');
}

// --- Stop links in the email ------------------------------------------------------------------

export function reportStopUrl(id: string, userId: string): string {
  const url = new URL('/api/email/report-stop', getEnv().APP_URL);
  url.searchParams.set('r', id);
  url.searchParams.set('u', userId);
  url.searchParams.set('t', emailLinkToken('report-stop', id, userId));
  return url.toString();
}

export function checkReportStop(p: { r?: string; u?: string; t?: string }): p is {
  r: string;
  u: string;
  t: string;
} {
  if (!p.r || !p.u || !p.t || !z.uuid().safeParse(p.r).success || !z.uuid().safeParse(p.u).success)
    return false;
  const want = Buffer.from(emailLinkToken('report-stop', p.r, p.u));
  const got = Buffer.from(p.t);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The email's stop link pauses the report. False for a link that isn't genuine. */
export async function stopReport(p: { r?: string; u?: string; t?: string }): Promise<boolean> {
  if (!checkReportStop(p)) return false;
  await getAppDb()
    .update(reportSchedule)
    .set({ paused: true })
    .where(and(eq(reportSchedule.id, p.r), eq(reportSchedule.userId, p.u)));
  return true;
}

// --- Building and sending -----------------------------------------------------------------------

/** The PDF for a report, worked out now with the recipient's view of the business. */
export async function reportPdf(
  member: MemberWorkspace,
  r: ReportSchedule,
  now = new Date(),
): Promise<{ fileName: string; body: Uint8Array; summary: string }> {
  if (r.kind === 'dashboard') {
    const pdf = await dashboardPdf(member, undefined, now);
    return {
      fileName: pdf.fileName,
      body: pdf.body,
      summary: 'Your dashboard, with today’s numbers.',
    };
  }
  const [a] = await getAppDb()
    .select({ question: answer.question, interpretation: answer.interpretation })
    .from(answer)
    .where(and(eq(answer.id, r.answerId!), eq(answer.workspaceId, member.workspace.id)));
  const i = a ? interpretationSchema.safeParse(a.interpretation) : undefined;
  if (!a || !i?.success || i.data.kind !== 'query')
    throw new ReportError('The question this report was made from can’t be answered any more.');
  const cc = compileContext(member, now);
  const cal = {
    today: cc.today,
    weekStart: cc.weekStart,
    fiscalYearStartMonth: cc.fiscalYearStartMonth,
  };
  const spec = i.data.spec;
  const data = toAnswerData(await runQuery(member, toQuerySpec(spec, cal), 'system'));
  const o = {
    pack: getPack(member.workspace.packId),
    locale: localeFor(member.settings),
    currency: member.settings.currency,
    fiscalYearStartMonth: member.settings.fiscalYearStartMonth,
  };
  const dates = periodLabel(periodOf(spec.timeRange, cal)) || 'All time';
  const kpis = kpiViews(data, o);
  const table = tableView(data, o);
  const single = data.rows.length <= 1;
  const body = await toPdf({
    title: a.question,
    subtitle: `${member.workspace.name} · ${dates}`,
    blocks: [
      {
        ...(single && kpis.length ? { kpis } : {}),
        ...(i.data.chart ? { chart: i.data.chart } : {}),
        ...(!single ? { table } : {}),
      },
    ],
    about: [
      { label: 'Dates', value: dates },
      {
        label: 'Made',
        value: new Intl.DateTimeFormat('en-GB', {
          timeZone: member.settings.timezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(now),
      },
    ],
  });
  const summary = single && kpis[0] ? `${kpis[0].label}: ${kpis[0].text} (${dates}).` : `${dates}.`;
  return { fileName: fileNameFor(a.question, 'pdf'), body, summary };
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Sends every report that is due today in this business and not sent for its period yet. Safe to
 * run many times a day. Returns how many went out.
 */
export async function sendDueReports(workspaceId: string, now = new Date()): Promise<number> {
  const db = getAppDb();
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
  if (!ws || ws.status !== 'active' || ws.isDemo) return 0;
  const rows = await db
    .select()
    .from(reportSchedule)
    .where(and(eq(reportSchedule.workspaceId, workspaceId), eq(reportSchedule.paused, false)));
  let sent = 0;
  for (const r of rows) {
    const member = await getMemberWorkspace(ws.slug, r.userId);
    // Someone who has left the business gets nothing.
    if (!member) continue;
    const today = compileContext(member, now).today;
    const period = reportPeriod(r.cadence, r.day, today);
    if (today < period.due || r.lastPeriod === period.key) continue;
    const key = `${r.id}:${period.key}`;
    if ((await claim(workspaceId, r.userId, 'report', [key])).length === 0) continue;
    try {
      const { fileName, body, summary } = await reportPdf(member, r, now);
      const [person] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, r.userId));
      if (!person) continue;
      const stop = reportStopUrl(r.id, r.userId);
      const open = `${getEnv().APP_URL}/w/${ws.slug}/${r.kind === 'dashboard' ? 'dashboard' : 'ask'}`;
      const when = whenText(r.cadence, r.day).toLowerCase();
      const ok = await deliver(workspaceId, r.userId, 'report', [key], {
        to: person.email,
        subject: `${ws.name}: ${r.title}`,
        text: [
          `Here’s your report for ${ws.name}: “${r.title}”. ${summary}`,
          '',
          'It’s attached as a PDF, worked out from your data today.',
          `See it in BizRetriever: ${open}`,
          '',
          `You get this ${when}. Stop it: ${stop}`,
        ].join('\n'),
        html: `<p>Here’s your report for <strong>${escapeHtml(ws.name)}</strong>: “${escapeHtml(r.title)}”. ${escapeHtml(summary)}</p><p>It’s attached as a PDF, worked out from your data today. <a href="${escapeHtml(open)}">See it in BizRetriever</a>.</p><p style="color:#59636e;font-size:12px">You get this ${escapeHtml(when)}. <a href="${escapeHtml(stop)}">Stop this report</a>.</p>`,
        headers: {
          'List-Unsubscribe': `<${stop}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        attachments: [{ filename: fileName, content: body, contentType: 'application/pdf' }],
      });
      await db
        .update(reportSchedule)
        .set(
          ok
            ? { lastPeriod: period.key, lastSentAt: now, lastError: null }
            : { lastError: 'The email couldn’t be sent. We’ll try again tomorrow.' },
        )
        .where(eq(reportSchedule.id, r.id));
      if (ok) sent += 1;
    } catch (err) {
      await db
        .update(reportSchedule)
        .set({
          lastError:
            err instanceof ReportError
              ? err.message
              : 'We couldn’t make this report. We’ll try again tomorrow.',
        })
        .where(eq(reportSchedule.id, r.id));
      // One report's trouble mustn't stop the others.
      getLogger('reports').error({ err, reportId: r.id, workspaceId }, 'report failed');
    }
  }
  return sent;
}
