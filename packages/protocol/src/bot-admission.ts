import { isSpeakingSeat, isJudgeSeat, sameSeat, type SeatRef } from './seats';
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
  return {
    kind: 'ready',
    activity: {
      segmentType: segment.type,
      opensExchange: round.rules.segments.some((rule) => {
        const lead = leadSeatOf(rule.speak);
        return (
          rule.key === segment.rulesSegmentKey &&
          lead !== null &&
          sameSeat(lead, seat.seat)
        );
      }),
      peerParticipantIds: round.participants
        .filter((row) => !isJudgeSeat(row.seat) && row.id !== seat.id)
        .map((row) => row.id),
    },
  };
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
