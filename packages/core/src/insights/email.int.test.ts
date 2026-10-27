import { closePools, emailDelivery, getAppDb, user, workspaceMember } from '@bizr/db';
import { setEmailTransport, type Email } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadDemoWorkspace, type DemoWorkspace } from '../testing';
import {
  getEmailPreferences,
  MAX_EMAIL_ATTEMPTS,
  sendInsightEmails,
  unsubscribe,
  unsubscribeUrl,
} from './email';
import { runInsights } from './service';

/** M9 (ADR-057): the weekly summary and urgent alerts go out once, to confirmed members only. */
const hasDb = await databaseAvailable();
const TODAY = '2026-10-13';
const NOW = new Date(`${TODAY}T16:00:00Z`);

describe.skipIf(!hasDb)('insight emails (integration)', () => {
  let demo: DemoWorkspace;
  let unconfirmedId: string;
  const sent: Email[] = [];

  beforeAll(async () => {
    demo = await loadDemoWorkspace({ today: TODAY, name: 'Fernwood Email Test' });
    const db = getAppDb();
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, demo.ownerId));
    const [u] = await db
      .insert(user)
      .values({ name: 'Unconfirmed', email: `unconfirmed-${crypto.randomUUID()}@example.test` })
      .returning({ id: user.id });
    unconfirmedId = u!.id;
    await db
      .insert(workspaceMember)
      .values({ workspaceId: demo.member.workspace.id, userId: unconfirmedId, role: 'member' });
    await runInsights(demo.member, { trigger: 'import', now: NOW, provider: null });
    setEmailTransport(async (e) => {
      sent.push(e);
    });
  }, 240_000);
  afterEach(() => {
    sent.length = 0;
  });
  afterAll(async () => {
    setEmailTransport(null);
    if (unconfirmedId) await getAppDb().delete(user).where(eq(user.id, unconfirmedId));
    await demo?.dispose();
    await closePools();
  });

  it('sends the weekly summary and the urgent alerts once, to confirmed members only', async () => {
    const first = await sendInsightEmails(demo.member, { now: NOW });
    expect(first).toEqual({ weeklySummaries: 1, urgentAlerts: 1 });
    const [owner] = await getAppDb().select().from(user).where(eq(user.id, demo.ownerId));
    expect(sent.map((e) => e.to)).toEqual([owner!.email, owner!.email]);
    const alert = sent.find(
      (e) => e.text.includes('need a look') || e.text.includes('needs a look'),
    )!;
    expect(alert.text).toContain('Sage Stoneware Mug will run out');
    const summary = sent.find((e) => e.subject.includes('your week of'))!;
    expect(summary.subject).toBe('Fernwood Email Test: your week of 5–11 Oct 2026');
    expect(summary.text).toMatch(/Net sales: \$[\d,]+\.\d\d/);
    expect(summary.headers?.['List-Unsubscribe']).toMatch(/^<http.*\/api\/email\/unsubscribe\?/);

    // A repeat run (worker restart, drain retry) sends nothing more.
    sent.length = 0;
    expect(await sendInsightEmails(demo.member, { now: NOW })).toEqual({
      weeklySummaries: 0,
      urgentAlerts: 0,
    });
    expect(sent).toHaveLength(0);
    const rows = await getAppDb()
      .select()
      .from(emailDelivery)
      .where(eq(emailDelivery.workspaceId, demo.member.workspace.id));
    expect(rows.every((r) => r.status === 'sent' && r.userId === demo.ownerId)).toBe(true);
  }, 60_000);

  it('tries a failed email again on the next run, up to three times', async () => {
    const db = getAppDb();
    const mine = eq(emailDelivery.workspaceId, demo.member.workspace.id);
    await db.delete(emailDelivery).where(mine);
    setEmailTransport(() => Promise.reject(new Error('email service down')));
    expect(await sendInsightEmails(demo.member, { now: NOW })).toEqual({
      weeklySummaries: 0,
      urgentAlerts: 0,
    });
    expect((await db.select().from(emailDelivery).where(mine)).map((r) => r.status)).toEqual([
      'failed',
      'failed',
    ]);
    setEmailTransport(async (e) => {
      sent.push(e);
    });
    expect(await sendInsightEmails(demo.member, { now: NOW })).toEqual({
      weeklySummaries: 1,
      urgentAlerts: 1,
    });
    const rows = await db.select().from(emailDelivery).where(mine);
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([
      ['sent', 2],
      ['sent', 2],
    ]);
    // Sent ones never go again; one that has failed three times is left alone.
    await db
      .update(emailDelivery)
      .set({ status: 'failed', attempts: MAX_EMAIL_ATTEMPTS })
      .where(mine);
    sent.length = 0;
    await sendInsightEmails(demo.member, { now: NOW });
    expect(sent).toHaveLength(0);
  }, 60_000);

  it('turns a kind off from the link in the email, and only with a genuine link', async () => {
    const url = new URL(unsubscribeUrl(demo.member.workspace.id, demo.ownerId, 'urgent_alert'));
    const q = Object.fromEntries(url.searchParams) as Record<string, string>;
    expect(await unsubscribe({ ...q, k: 'weekly_summary' })).toBe(false);
    expect(await getEmailPreferences(demo.member.workspace.id, demo.ownerId)).toEqual({
      weeklySummary: true,
      urgentAlerts: true,
    });
    expect(await unsubscribe(q)).toBe(true);
    expect(await getEmailPreferences(demo.member.workspace.id, demo.ownerId)).toEqual({
      weeklySummary: true,
      urgentAlerts: false,
    });
  });

  it('sends nothing from a demo shop', async () => {
    await getAppDb()
      .delete(emailDelivery)
      .where(eq(emailDelivery.workspaceId, demo.member.workspace.id));
    const demoShop = { ...demo.member, workspace: { ...demo.member.workspace, isDemo: true } };
    expect(await sendInsightEmails(demoShop, { now: NOW })).toEqual({
      weeklySummaries: 0,
      urgentAlerts: 0,
    });
    expect(sent).toHaveLength(0);
  });
});
