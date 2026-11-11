import {
  idle,
  refusedWith,
  type Idle,
  type Refused,
} from '../../forms/form-state';

/** Accepted, with the authorized aggregate after it, for an HTTP-only history view. */
type ReactionCounted = {
  readonly kind: 'counted';
  readonly own: boolean;
  readonly count: number;
};
/** Accepted, and the answer carries no count for this reaction: the pill keeps the one it shows. */
type ReactionMarked = { readonly kind: 'marked'; readonly own: boolean };
/** Withdrawn, but the count could not be read again (ADR 0075 grants a withdrawal no read). */
type ReactionUncounted = { readonly kind: 'uncounted' };

/** What a reaction pill's toggle answers. */
export type ReactionPillState =
  Idle | Refused | ReactionCounted | ReactionMarked | ReactionUncounted;

export const initialReactionPill: ReactionPillState = idle();
/** Every field a pill posts is in its props, so a refusal keeps none. */
export const reactionPillUnavailable = (): Refused =>
  refusedWith({}, 'Reaction could not be changed. Try again.');
export const reactionCounted = (
  own: boolean,
  count: number,
): ReactionCounted => ({ kind: 'counted', own, count });
export const reactionMarked = (own: boolean): ReactionMarked => ({
  kind: 'marked',
  own,
});
export const reactionWithdrawnUncounted: ReactionUncounted = {
  kind: 'uncounted',
};

/** What a pill renders from its answer; `own` and `count` are set only once a change was accepted. */
export type ReactionPillFields = {
  readonly notice: string | undefined;
  readonly own: boolean | undefined;
  readonly count: number | undefined;
};

export function reactionPillFields(
  answer: ReactionPillState,
): ReactionPillFields {
  switch (answer.kind) {
    case 'idle':
      return { notice: undefined, own: undefined, count: undefined };
    case 'refused':
      return { notice: answer.error, own: undefined, count: undefined };
    case 'counted':
      return { notice: undefined, own: answer.own, count: answer.count };
    case 'marked':
      return { notice: undefined, own: answer.own, count: undefined };
    case 'uncounted':
      return {
        notice: 'Reaction removed. Reload to see the current count.',
        own: false,
        count: undefined,
      };
  }
}
