import {
  daisyBallotFor,
  daisyBallotSource,
  panelRuleFor,
  type RoundJudging,
} from '@daisy/protocol/ballot-definition';
import { type RoundRules } from '@daisy/protocol/format';

/**
 * What a Round launched from Daisy's catalogue is judged on (TAB-6.11): the
 * Daisy ballot its outcome kind implies, decided by that ballot's panel rule
 * over the Round's judge seats (half of them, rounded up, is its quorum).
 * It is frozen on the Round when it launches, even with no judge seated, so
 * the panel that completes the Round reads one frozen rule; a Round whose
 * outcome nobody decides has none.
 */
export const frozenJudgingFor = (
  rules: Pick<RoundRules, 'outcome' | 'seats'>,
): RoundJudging => {
  const ballot = daisyBallotFor(rules.outcome);
  return ballot
    ? {
        source: daisyBallotSource(ballot),
        ballot,
        panel: panelRuleFor(ballot, rules.seats.judges),
      }
    : null;
};
