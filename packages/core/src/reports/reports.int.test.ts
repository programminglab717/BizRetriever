import { closePools, getAppDb, reportSchedule, user, workspaceMember } from '@bizr/db';
import { setEmailTransport, type Email } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { askQuestion } from '../ask/service';
import { loadDemoWorkspace, pdfText, type DemoWorkspace } from '../testing';
import { getMemberWorkspace, type MemberWorkspace } from '../workspaces/service';
import {
  createReport,
  listReports,
  ReportError,
  reportPeriod,
  sendDueReports,
  stopReport,
  updateReport,
} from './service';

/** M15 (ADR-065): reports go once per period, fresh, to the person who asked, until stopped. */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13'; // a Tuesday
const at = (day: string) => new Date(`${day}T16:00:00Z`);
const noAi = { provider: null, aiMode: 'never' as const };

describe('reportPeriod', () => {
  it('names weeks and months, with the day each report is due', () => {
    expect(reportPeriod('weekly', 2, '2026-10-13')).toEqual({ key: '2026-W42', due: '2026-10-13' });
    expect(reportPeriod('weekly', 1, '2026-10-18')).toEqual({ key: '2026-W42', due: '2026-10-12' });
    expect(reportPeriod('weekly', 1, '2027-01-01')).toEqual({ key: '2026-W53', due: '2026-12-28' });
    expect(reportPeriod('monthly', 1, '2026-11-02')).toEqual({ key: '2026-11', due: '2026-11-01' });
  });
});

describe.skipIf(!hasDb)('scheduled reports (integration)', () => {
  let demo: DemoWorkspace;
  let viewer: MemberWorkspace;
  let viewerId: string;
  const sent: Email[] = [];

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: TODAY, name: 'Fernwood Reports Test' });
    const [u] = await getAppDb()
      .insert(user)
      .values({ name: 'Vera', email: `vera-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    viewerId = u!.id;
    await getAppDb()
      .insert(workspaceMember)
      .values({ workspaceId: demo.member.workspace.id, userId: viewerId, role: 'viewer' });
    viewer = (await getMemberWorkspace(demo.member.workspace.slug, viewerId))!;
    setEmailTransport(async (e) => {
      sent.push(e);
    });
  }, 240_000);
  afterAll(async () => {
    setEmailTransport(null);
    await demo?.dispose();
    if (viewerId) await getAppDb().delete(user).where(eq(user.id, viewerId));
    await closePools();
  });

  it('emails the dashboard every week, once, starting next period, with the PDF attached', async () => {
    const r = await createReport(
      demo.member,
      demo.ownerId,
      { kind: 'dashboard', cadence: 'weekly', day: 2 },
      at(TODAY),
    );
    expect(r.when).toBe('Every Tuesday');
    // Set up on the day itself: this week's has "gone", the first comes next week.
    expect(await sendDueReports(demo.member.workspace.id, at(TODAY))).toBe(0);
    expect(await sendDueReports(demo.member.workspace.id, at('2026-10-19'))).toBe(0);
    expect(await sendDueReports(demo.member.workspace.id, at('2026-10-20'))).toBe(1);
    expect(await sendDueReports(demo.member.workspace.id, at('2026-10-20'))).toBe(0);
    expect(await sendDueReports(demo.member.workspace.id, at('2026-10-23'))).toBe(0);
    const email = sent.at(-1)!;
    expect(email.subject).toBe('Fernwood Reports Test: Fernwood Reports Test dashboard');
    expect(email.text).toContain('You get this every tuesday. Stop it: http');
    const pdf = email.attachments![0]!;
    expect(pdf).toMatchObject({
      filename: 'Fernwood Reports Test dashboard.pdf',
      contentType: 'application/pdf',
    });
    expect(pdfText(pdf.content).join('\n')).toContain('Net sales');
    expect((await listReports(demo.member, demo.ownerId))[0]!.lastSentAt).not.toBeNull();
  }, 120_000);

  it('re-runs a question every month with that day’s data, for a viewer too', async () => {
    const a = await askQuestion(
      viewer,
      viewerId,
      { question: 'Net sales by channel last month' },
      noAi,
    );
    await createReport(
      viewer,
      viewerId,
      { kind: 'question', answerId: a.answerId, cadence: 'monthly', day: 1 },
      at(TODAY),
    );
    sent.length = 0;
    expect(await sendDueReports(demo.member.workspace.id, at('2026-11-02'))).toBe(1);
    const email = sent.find((e) => e.subject.includes('Net sales by channel last month'))!;
    const text = pdfText(email.attachments![0]!.content).join('\n');
    // "Last month" is worked out on the day it's sent: October, not September.
    expect(text).toContain('October 2026');
    expect(text).not.toContain('September 2026');
  }, 120_000);

  it('refuses answers without numbers, and anyone else’s report', async () => {
    const q = await askQuestion(
      demo.member,
      demo.ownerId,
      { question: 'Who are my best customers?' },
      noAi,
    );
    await expect(
      createReport(demo.member, demo.ownerId, {
        kind: 'question',
        answerId: q.answerId,
        cadence: 'weekly',
        day: 1,
      }),
    ).rejects.toThrow(ReportError);
    const [mine] = await listReports(demo.member, demo.ownerId);
    await expect(updateReport(viewer, viewerId, mine!.id, 'delete')).rejects.toThrow(/isn’t there/);
  });

  it('stops from the email’s link, and sends nothing to someone who left', async () => {
    const link = new URL(sent.at(-1)!.text.match(/Stop it: (\S+)/)![1]!);
    const p = Object.fromEntries(link.searchParams);
    expect(await stopReport({ ...p, t: 'forged' })).toBe(false);
    expect(await stopReport(p)).toBe(true);
    await getAppDb()
      .delete(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, demo.member.workspace.id),
          eq(workspaceMember.userId, viewerId),
        ),
      );
    sent.length = 0;
    // The owner's weekly one still goes; the viewer's (stopped, and they left) doesn't.
    expect(await sendDueReports(demo.member.workspace.id, at('2026-12-01'))).toBe(1);
    expect(sent.every((e) => !e.subject.includes('by channel'))).toBe(true);
    const rows = await getAppDb()
      .select()
      .from(reportSchedule)
      .where(eq(reportSchedule.workspaceId, demo.member.workspace.id));
    expect(rows.find((r) => r.userId === viewerId)?.paused).toBe(true);
  }, 120_000);
});
