import type { BallotDefinition } from '@daisy/protocol/ballot-definition';
import { anchorsSummary, sheetGroupsOf } from './ballot-sheet';

/**
 * How a ballot works, in the judge's words, from its definition alone
 * (TAB-6.17): the decision, the scores, who reads what and the limits. The
 * window line is the page's, since it is the panel's rule, not the ballot's.
 */
export function ballotRuleLines(definition: BallotDefinition): string[] {
  const { decision, points, written } = definition;
  const subjects =
    decision.kind === 'ranking' && decision.of === 'speakers'
      ? 'speaker'
      : 'side';
  const decisionLine = (): string => {
    switch (decision.kind) {
      case 'winner':
        return decision.tie || decision.doubleLoss
          ? `Pick one winner, or record ${[decision.tie ? 'a tie' : null, decision.doubleLoss ? 'a loss for both' : null].filter(Boolean).join(' or ')}.`
          : 'Pick one winner. There are no draws.';
      case 'ranking':
        return decision.ties
          ? `Place every ${subjects} in order. Two may share a place.`
          : `Place every ${subjects} in order, each in a place of its own.`;
    }
  };
  const scoreLines = (): string[] => {
    if (!points) return [];
    const scored =
      points.per === 'speech'
        ? 'each speech'
        : points.per === 'seat'
          ? 'each speaker'
          : 'each debater';
    const range = `from ${points.scale.min} to ${points.scale.max}`;
    if (points.criteria.kind === 'holistic')
      return [`Score ${scored} ${range}.`];
    const rows = sheetGroupsOf(points).flatMap((group) => group.rows);
    const [first] = rows;
    const anchors =
      first && first.anchors.length > 0
        ? ` Under each category, open “${anchorsSummary(first)}” to see its anchors.`
        : '';
    const lowPoint =
      decision.kind === 'winner' && points.per === 'side'
        ? [
            decision.lowPointWin
              ? 'A win on fewer speaker points is allowed; you confirm it before submitting.'
              : 'The winner never has fewer speaker points than another side.',
          ]
        : [];
    return [
      `Score ${scored} ${range} in all ${rows.length} categories.${anchors}`,
      ...lowPoint,
    ];
  };
  return [
    decisionLine(),
    ...scoreLines(),
    written.reason === null
      ? 'Reason for decision is off.'
      : written.reason.required
        ? `Your reason for decision is required and both debaters read it (up to ${written.reason.max} characters).`
        : `A reason for decision is optional, and every debater reads it (up to ${written.reason.max} characters).`,
    written.feedback === null
      ? 'Feedback is off.'
      : written.feedback.required
        ? `Feedback is required, and each debater reads only their own (up to ${written.feedback.max} characters).`
        : `Feedback is optional, and each debater reads only their own (up to ${written.feedback.max} characters).`,
  ];
}
