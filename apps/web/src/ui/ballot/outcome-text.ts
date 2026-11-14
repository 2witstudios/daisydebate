import type { RoundOutcome } from '@daisy/protocol';
import { subjectOf, type BallotPlan } from '../../features/judge/ballot-plan';

/**
 * A Round's outcome in words, from its ballot's subjects: the winning side
 * by its label, or the places in order.
 */
export function outcomeText(plan: BallotPlan, outcome: RoundOutcome): string {
  const name = (key: string) => {
    const subject = subjectOf(plan, key);
    return subject
      ? outcome.kind === 'winner'
        ? subject.role
        : subject.name
      : key;
  };
  switch (outcome.kind) {
    case 'winner':
      return name(outcome.side);
    case 'ranking':
      return outcome.places
        .map((place, index) => `${index + 1}. ${place.map(name).join(' and ')}`)
        .join(', ');
  }
}
