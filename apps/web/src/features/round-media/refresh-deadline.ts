import type { RoundView } from '@daisy/protocol';

/** These deadlines request a server read; they never open a browser microphone. */
export function nextMediaRefreshAt(view: RoundView): number | null {
  const last = view.segments.at(-1);
  const deadlines: number[] = [];
  if (last?.endedAt === null)
    deadlines.push(Date.parse(last.startedAt) + last.durationMs);
  const prep = view.checkpoint?.active_prep;
  if (prep && view.rules.inRoundPrep)
    deadlines.push(
      Date.parse(prep.started_at) +
        view.rules.inRoundPrep.budgetMsPerSide -
        view.checkpoint!.prep_consumed_ms[prep.side],
    );
  if (last?.endedAt && view.segments.length === view.rules.segments.length)
    deadlines.push(Date.parse(last.endedAt) + 30 * 60_000);
  const finite = deadlines.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}
