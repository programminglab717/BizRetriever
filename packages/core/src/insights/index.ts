export {
  effectiveThresholds,
  evaluateRule,
  severityScore,
  type Candidate,
  type FactValue,
  type Level,
} from './evaluate';
export { formatInsightFact, insightText, renderInsight, type InsightSegment } from './render';
export {
  loadInsightTarget,
  renderCandidate,
  runInsights,
  type InsightRunSummary,
  type InsightTarget,
} from './service';
export {
  dismissInsight,
  getAlertSettings,
  getInsights,
  InsightError,
  lastInsightRun,
  markInsightsSeen,
  saveAlertSetting,
  type AlertSetting,
  type AlertThreshold,
  type InsightCard,
  type InsightOverview,
} from './feed';
export {
  currentDigest,
  dismissDigest,
  ensureWeeklyDigest,
  weekOf,
  type DigestContent,
  type DigestKpi,
} from './digest';
export {
  insightsDailyJob,
  insightsRunJob,
  insightTriggers,
  requestInsightRun,
  scheduleDailyJobs,
  type InsightTrigger,
} from './jobs';
export { homeKpis, type HomeKpis } from './home';
export {
  checkUnsubscribe,
  getEmailPreferences,
  saveEmailPreferences,
  sendInsightEmails,
  unsubscribe,
  unsubscribeUrl,
  urgentAlertEmail,
  weekLabel,
  weeklySummaryEmail,
  type EmailPreferences,
  type EmailRunSummary,
} from './email';
