import { addDays, type IsoDate } from './dates';
import { Rng } from './rng';
import type { Sale, Simulation } from './simulate';

/**
 * "Next month's export" of the website orders (M6 re-upload demo): the same orders as before, except
 * that the oldest few have dropped off the export, a few recent ones were cancelled since, and a
 * month of new orders was added. The answer key says exactly what a correct merge finds.
 */
export interface NextMonthTruth {
  today: IsoDate;
  /** Order numbers that are new in this export. */
  added: string[];
  /** Line count of the new orders. */
  addedLines: number;
  /** Orders whose status changed (completed → cancelled). */
  cancelled: string[];
  /** Orders in the old export but not this one (must be kept, not deleted). */
  dropped: string[];
}

export function nextMonthUpdate(
  sim: Simulation,
  options: { days?: number; seed?: number; drop?: number; cancel?: number } = {},
): { sim: Simulation; truth: NextMonthTruth } {
  const days = options.days ?? 30;
  const rng = new Rng((options.seed ?? 42) ^ 0x6e78);
  const web = sim.sales.filter((s) => s.channel === 'online_store');
  const dropped = web.slice(0, options.drop ?? 12);
  const dropSet = new Set(dropped);
  const recent = web.filter((s) => s.status === 'completed' && !dropSet.has(s)).slice(-60);
  const cancelled = new Set<Sale>();
  while (cancelled.size < Math.min(options.cancel ?? 4, recent.length))
    cancelled.add(recent[rng.int(0, recent.length - 1)]!);

  let next = Math.max(...web.map((s) => Number(s.number.replace('#', '')))) + 1;
  const added: Sale[] = [];
  for (let d = 1; d <= days; d++) {
    const date = addDays(sim.today, d);
    const count = rng.poisson(5.2);
    for (let i = 0; i < count; i++) {
      const like = web[rng.int(0, web.length - 1)]!;
      added.push({
        ...like,
        number: `#${next++}`,
        date,
        minutes: rng.int(0, 24 * 60 - 1),
        status: 'completed',
        lines: like.lines.map((l) => ({ ...l })),
        note: null,
      });
    }
  }
  const sales = [
    ...sim.sales
      .filter((s) => !dropSet.has(s))
      .map((s) => (cancelled.has(s) ? { ...s, status: 'cancelled' as const } : s)),
    ...added,
  ];
  const today = addDays(sim.today, days);
  return {
    sim: { ...sim, today, sales },
    truth: {
      today,
      added: added.map((s) => s.number),
      addedLines: added.reduce((t, s) => t + s.lines.length, 0),
      cancelled: [...cancelled].map((s) => s.number),
      dropped: dropped.map((s) => s.number),
    },
  };
}
