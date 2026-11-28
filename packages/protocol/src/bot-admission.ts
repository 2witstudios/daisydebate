import {
  isSpeakingSeat,
  isJudgeSeat,
  sameSeat,
  sideOfSeat,
  type SeatRef,
} from './seats';
import { leadSeatOf } from './format-seating';
import type { RoundRules } from './format';
import { roundStatus } from './round';

/** Leased control is available to a speaking seat, independently of its current floor. */
export const botClaimSeatAdmitted = (
  round: { readonly status: string },
  seat: { readonly seat: SeatRef },
) => round.status === roundStatus.active && isSpeakingSeat(seat.seat);
export type BotClaimActivity = {
  readonly segmentType: 'speech' | 'cross_ex';
  readonly opensExchange: boolean;
  readonly peerParticipantIds: readonly string[];
};
export function decideBotClaimActivity(
  round: {
    readonly rules: Pick<RoundRules, 'segments'>;
    readonly participants: readonly {
      readonly id: string;
      readonly seat: SeatRef;
    }[];
    /** Seats that left answer nobody and are owed nothing (INTX-12). */
    readonly checkpoint?: {
      readonly absent_participant_ids?: readonly string[] | undefined;
    };
  },
  seat: { readonly id: string; readonly seat: SeatRef },
  segment:
    | {
        readonly type: 'speech' | 'cross_ex' | 'open';
        readonly rulesSegmentKey: string;
      }
    | undefined,
):
  | { readonly kind: 'ready'; readonly activity: BotClaimActivity }
  | { readonly kind: 'missing' | 'open' } {
  if (!segment) return { kind: 'missing' };
  if (segment.type === 'open') return { kind: 'open' };
  const rule = round.rules.segments.find(
    (candidate) => candidate.key === segment.rulesSegmentKey,
  );
  const lead = rule === undefined ? null : leadSeatOf(rule.speak);
  const opensExchange = lead !== null && sameSeat(lead, seat.seat);
  return {
    kind: 'ready',
    activity: {
      segmentType: segment.type,
      opensExchange,
      peerParticipantIds:
        segment.type === 'cross_ex'
          ? crossExaminationPeers(round, seat, lead, opensExchange)
          : [],
    },
  };
}

/**
 * Whom a bot answers in cross-examination (INTX-11): only the other side, and
 * only once per side. The asker answers the answering side; on the answering
 * side the first seat answers the asker's side; any other seat of either side
 * stays quiet, so partners never double a question or an answer. Unsided, it
 * answers everyone else.
 */
function crossExaminationPeers(
  round: {
    readonly participants: readonly {
      readonly id: string;
      readonly seat: SeatRef;
    }[];
    readonly checkpoint?: {
      readonly absent_participant_ids?: readonly string[] | undefined;
    };
  },
  seat: { readonly id: string; readonly seat: SeatRef },
  lead: SeatRef | null,
  asks: boolean,
): readonly string[] {
  const absent = round.checkpoint?.absent_participant_ids ?? [];
  // Only seats still present ask, answer or are answered.
  const present = round.participants.filter(
    (row) => !isJudgeSeat(row.seat) && !absent.includes(row.id),
  );
  const others = present.filter((row) => row.id !== seat.id);
  const side = sideOfSeat(seat.seat);
  const askingSide = lead === null ? null : sideOfSeat(lead);
  if (side === null || askingSide === null) return others.map((row) => row.id);
  const opposing = others.filter((row) => sideOfSeat(row.seat) !== side);
  if (asks) return opposing.map((row) => row.id);
  if (side === askingSide) return [];
  const answerer = present
    .filter((row) => sideOfSeat(row.seat) === side)
    .sort((a, b) => a.seat.slot - b.seat.slot)[0];
  return answerer?.id === seat.id
    ? opposing
        .filter((row) => sideOfSeat(row.seat) === askingSide)
        .map((row) => row.id)
    : [];
}
export type BotGenerationAdmission =
  | {
      readonly kind: 'language';
      readonly model: string | null;
      readonly workerKind: string;
      readonly answered: boolean;
      readonly said: boolean;
    }
  | {
      readonly kind: 'tts';
      readonly model: string;
      readonly spoken: number;
      readonly characters: number;
      readonly budget: number;
    };
/** A received or already-spoken answer is bought once, even across control recovery. */
export function decideBotGeneration(
  input: BotGenerationAdmission,
):
  | { readonly kind: 'admit'; readonly model: string }
  | { readonly kind: 'final'; readonly message: string }
  | { readonly kind: 'unconfigured' } {
  if (input.kind === 'language' && input.workerKind === 'speech') {
    if (input.answered)
      return { kind: 'final', message: 'Speech already answered' };
    if (input.said) return { kind: 'final', message: 'Speech already begun' };
  }
  if (input.kind === 'tts' && input.spoken + input.characters > input.budget)
    return { kind: 'final', message: 'Speech budget exhausted' };
  if (!input.model?.trim()) return { kind: 'unconfigured' };
  return { kind: 'admit', model: input.model };
}
