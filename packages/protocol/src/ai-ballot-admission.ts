import type { BallotDefinition } from './ballot-definition';
import type { RoundRules } from './format';
import { heldSeatsComplete } from './format-seating';
import type { SeatRef } from './seats';

/** The supported AI ballot boundary, shared by atomic Start and the worker. */
export const aiBallotAdmissionRefusal = (
  definition: BallotDefinition,
  rules: {
    readonly sides: readonly { readonly key: string }[];
    readonly seats?: RoundRules['seats'];
  },
  participants: readonly { readonly id: string; readonly seat: SeatRef }[],
): 'ai-judge-unsided-format' | 'ai-judge-frozen-subjects' | null => {
  if (rules.sides.length < 2) return 'ai-judge-unsided-format';
  const needsCast =
    definition.speakerRanks ||
    (definition.decision.kind === 'ranking' &&
      definition.decision.of === 'speakers') ||
    (definition.points !== null && definition.points.per !== 'side');
  if (
    needsCast &&
    (!rules.seats ||
      !heldSeatsComplete(
        { sides: rules.sides, seats: rules.seats },
        participants.map((p) => p.seat),
      ) ||
      new Set(participants.map((p) => p.id)).size !== participants.length)
  )
    return 'ai-judge-frozen-subjects';
  return null;
};
