import type { RoomView } from '@daisy/protocol';
import { aiJudgePremiumText } from '../../../features/rooms/ai-judge-copy';

/** Null is not the host's view, which offers no seating at all. */
export const aiJudgeSeatable = (seating: RoomView['aiJudgeSeating']) =>
  seating === 'free' || seating === 'included';

/**
 * States what the host can do about judging (WATCH-16): free on ranked, and
 * for a casual host without the entitlement, a person judges. A ballot that
 * exists is never behind this; it speaks only to seating.
 */
export function AiJudgeNotice({
  view,
}: {
  readonly view: Pick<
    RoomView,
    'aiJudgeSeating' | 'definition' | 'competitionType'
  >;
}) {
  if (view.definition.seats.judge === 0) return null;
  if (view.aiJudgeSeating === 'free')
    return (
      <p role="status" className="py-3 text-sm text-ink-muted">
        {view.competitionType === 'ranked'
          ? 'An AI judge is free on ranked rounds.'
          : 'Your one free bot debate includes an optional AI judge.'}
      </p>
    );
  if (view.aiJudgeSeating === 'premium')
    return (
      <p role="status" className="py-3 text-sm text-ink-muted">
        {aiJudgePremiumText}{' '}
        <a href="/premium" className="underline">
          Explore Premium
        </a>
      </p>
    );
  return null;
}
