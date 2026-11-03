import { mediaWindowEndsAt } from '@daisy/debate-engine/media-window';
import type { RoundView } from '@daisy/protocol';

const gapRefreshAt = (view: RoundView): number | null => {
  if (
    view.checkpoint?.active_prep ||
    view.segments.length >= view.rules.segments.length
  )
    return null;
  const anchor =
    view.segments.length === 0 ? view.startedAt : view.segments.at(-1)?.endedAt;
  return anchor ? Date.parse(anchor) + view.rules.countdownMs : null;
};
const mediaCloseRefreshAt = (view: RoundView): number[] => {
  const last = view.segments.at(-1);
  return last?.endedAt && view.segments.length === view.rules.segments.length
    ? [mediaWindowEndsAt(last.endedAt)]
    : [];
};
/** These deadlines request a server read; they never open a browser microphone. */
export function nextMediaRefreshAt(view: RoundView): number | null {
  const last = view.segments.at(-1);
  const gap = gapRefreshAt(view);
  const deadlines: number[] = gap === null ? [] : [gap];
  if (last?.endedAt === null)
    deadlines.push(Date.parse(last.startedAt) + last.durationMs);
  const prep = view.checkpoint?.active_prep;
  if (prep && view.rules.inRoundPrep)
    deadlines.push(
      Date.parse(prep.started_at) +
        view.rules.inRoundPrep.budgetMsPerSide -
        view.checkpoint!.prep_consumed_ms[prep.side],
    );
  deadlines.push(...mediaCloseRefreshAt(view));
  const finite = deadlines.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}
