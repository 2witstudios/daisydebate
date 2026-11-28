import { instantMs } from '@daisy/clock/instant';
import type {
  PointsOfInformationRule,
  RoundRules,
} from '@daisy/protocol/format';
import { pointEndsAtMs, type PointOfInformation } from '@daisy/protocol/round';
import { segmentDueAtMs } from '@daisy/protocol/segment-end';
import type { ClockSegment, ClockState } from './round-clock-state';
import type { ClockTransition } from './round-clock-transition';

/**
 * Points of information (INTX-13..15), as pure time and state. A speech that
 * takes them has an offer window between its protected start and protected
 * end; offers lapse, and an accepted point gives the speech back, each at its
 * own exact instant, computed from stored instants alone. A platform incident
 * ends any offer or point (the clock is held), so no wait here ever spans a
 * clock stop.
 */

const iso = (ms: number): string => new Date(ms).toISOString();

type TakingRule = Extract<PointsOfInformationRule, { allowed: true }>;

/** The rule a segment takes points of information under, or null: only a one-speaker speech does. */
export const pointsOfInformationIn = (
  rules: RoundRules,
  sequence: number,
): TakingRule | null => {
  const rule = rules.interaction.pointsOfInformation;
  const segment = rules.segments[sequence];
  return rule.allowed &&
    segment?.type === 'speech' &&
    segment.speak.rights === 'one'
    ? rule
    : null;
};

/**
 * When offers open and close in this speech, in speech time: the protected
 * start runs from the speech's start plus any airtime an incident returned,
 * and the protected end is the last stretch before the speech is due.
 */
export const offerWindowOf = (
  open: ClockSegment,
  rule: TakingRule,
): { readonly opensAtMs: number; readonly closesAtMs: number } => ({
  opensAtMs: open.startedAtMs + open.returnedMs + rule.protectedStartMs,
  closesAtMs: segmentDueAtMs(open) - rule.protectedEndMs,
});

/** When one standing offer sits down by itself: its lapse, or the protected end. */
export const offerLapsesAtMs = (
  offeredAt: string,
  rule: TakingRule,
  closesAtMs: number,
): number => Math.min(instantMs(offeredAt) + rule.offerLapseMs, closesAtMs);

const withPoint = (
  state: ClockState,
  point: PointOfInformation,
): ClockState => ({
  ...state,
  checkpoint: { ...state.checkpoint, point_of_information: point },
});

/**
 * The next time-driven change to the open speech's point of information, if
 * one is due by `nowMs` and before the speech itself is: an accepted point
 * reaching its limit, or the earliest standing offers lapsing. Null when
 * nothing is due; the clock then looks at the segment's own end.
 */
export const duePointOfInformationChange = (
  state: ClockState,
  rules: RoundRules,
  open: ClockSegment,
  nowMs: number,
): ClockTransition | null => {
  const point = state.checkpoint.point_of_information;
  const rule = pointsOfInformationIn(rules, open.sequence);
  if (point.phase === 'none' || rule === null) return null;
  const speechDue = segmentDueAtMs(open);
  const due = (atMs: number) => atMs <= nowMs && atMs < speechDue;
  if (point.phase === 'speaking') {
    const atMs = pointEndsAtMs(point, rule.maxDurationMs);
    return atMs !== null && due(atMs)
      ? {
          state: withPoint(state, { phase: 'none' }),
          changes: [
            {
              kind: 'speakers',
              sequence: open.sequence,
              atMs,
              poiHolder: null,
            },
          ],
        }
      : null;
  }
  const { closesAtMs } = offerWindowOf(open, rule);
  const lapses = point.offers.map((offer) =>
    offerLapsesAtMs(offer.offered_at, rule, closesAtMs),
  );
  const atMs = Math.min(...lapses);
  if (!due(atMs)) return null;
  const standing = point.offers.filter((_, index) => lapses[index]! > atMs);
  return {
    state: withPoint(
      state,
      standing.length > 0
        ? { phase: 'offered', offers: standing }
        : { phase: 'none' },
    ),
    changes: [],
  };
};

/** Whether this seat has an offer standing. */
export const isOffering = (
  point: PointOfInformation,
  participantId: string,
): boolean =>
  point.phase === 'offered' &&
  point.offers.some((offer) => offer.participant_id === participantId);

/** A seat stands to offer; legality has already admitted it. */
export const offerPoint = (
  point: PointOfInformation,
  participantId: string,
  nowMs: number,
): PointOfInformation => ({
  phase: 'offered',
  offers: [
    ...(point.phase === 'offered' ? point.offers : []),
    { participant_id: participantId, offered_at: iso(nowMs) },
  ],
});

/** A seat sits back down; the last one leaves nobody standing. */
export const withdrawOffer = (
  point: PointOfInformation,
  participantId: string,
): PointOfInformation => {
  if (point.phase !== 'offered') return point;
  const offers = point.offers.filter(
    (offer) => offer.participant_id !== participantId,
  );
  return offers.length > 0 ? { phase: 'offered', offers } : { phase: 'none' };
};

/** The speaker takes one offer; everyone else sits down. */
export const acceptOffer = (
  offererParticipantId: string,
  nowMs: number,
): PointOfInformation => ({
  phase: 'speaking',
  holder_participant_id: offererParticipantId,
  accepted_at: iso(nowMs),
});
