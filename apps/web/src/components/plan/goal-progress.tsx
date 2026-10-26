import {
  goalLines,
  STATUS_LABEL,
  type EstimateStyle,
  type GoalProgress,
} from '@bizr/core/planning';

import { cn } from '@/lib/utils';

const TONE: Record<GoalProgress['status'], string> = {
  reached: 'bg-emerald-100 text-emerald-900',
  ahead: 'bg-emerald-100 text-emerald-900',
  on_track: 'bg-sky-100 text-sky-900',
  behind: 'bg-amber-100 text-amber-900',
  unknown: 'bg-muted text-foreground',
};

/** One goal: a bar for this month so far, the estimate for the month, and what each day needs. */
export function GoalProgressView({ goal, style }: { goal: GoalProgress; style: EstimateStyle }) {
  const lines = goalLines(goal, style);
  const done = Math.min(100, Math.round(goal.share * 100));
  const heading =
    goal.projected && Number(goal.target) > 0
      ? Math.min(100, Math.round((goal.projected.total / Number(goal.target)) * 100))
      : null;
  return (
    <div className="grid gap-2" data-testid="goal-progress">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{goal.metric.label}</h3>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONE[goal.status])}>
          {STATUS_LABEL[goal.status]}
        </span>
      </div>
      <div
        className="relative h-3 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${done}% of the goal so far${heading !== null ? `, heading for about ${heading}%` : ''}`}
      >
        {heading !== null && (
          <div
            className="absolute inset-y-0 left-0 bg-primary/25"
            style={{ width: `${heading}%` }}
          />
        )}
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${done}%` }} />
      </div>
      <p className="text-sm">{lines.soFar}</p>
      {lines.heading && <p className="text-sm text-muted-foreground">{lines.heading}</p>}
      {lines.need && <p className="text-sm text-muted-foreground">{lines.need}</p>}
    </div>
  );
}
