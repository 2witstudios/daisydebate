'use client';

import { useMemo } from 'react';
import type {
  BallotDefinition,
  BallotDraft,
  BallotSubject,
} from '../../../features/tab/ballot-definition';
import {
  criteriaOf,
  pointsField,
  scoreField,
} from '../../../features/judge/ballot';
import type { BallotPlan } from '../../../features/judge/ballot-plan';
import { BallotFields } from '../../judge/ballot-page/ballot-form';

/** Named sample subjects use the ordinary canonical ballot fields, never a second ballot grammar. */
export function ConfiguredBallot({
  definition,
  subjects,
  draft,
  reasonReaders,
  preview = false,
}: {
  readonly definition: BallotDefinition;
  readonly subjects: readonly BallotSubject[];
  readonly draft: BallotDraft;
  readonly reasonReaders: string;
  readonly preview?: boolean;
}) {
  const plan = useMemo<BallotPlan>(() => {
    const named = subjects.map((subject, tone) => ({
      key: subject.id,
      name: subject.name,
      role: subject.role ?? '',
      short: subject.role ?? subject.name,
      tone,
    }));
    const speakersOnly =
      definition.decision.kind === 'ranking' &&
      definition.decision.of === 'speakers';
    return {
      definition,
      subjects: {
        sides: speakersOnly ? [] : subjects.map((subject) => subject.id),
        speakers: subjects.map((subject) => subject.id),
        segments: [],
      },
      decided: named,
      scored: definition.points ? named : [],
      speakers: named,
    };
  }, [definition, subjects]);
  const values = useMemo(() => {
    const points = definition.points;
    const scores = !points
      ? []
      : subjects.flatMap((subject) =>
          points.criteria.kind === 'grid'
            ? criteriaOf(points).map((criterion) => [
                scoreField(subject.id, criterion.id),
                String(
                  draft.points[`${subject.id}:${criterion.id}`] ??
                    points.default,
                ),
              ])
            : [
                [
                  pointsField(subject.id),
                  String(draft.points[subject.id] ?? points.default),
                ],
              ],
        );
    return Object.fromEntries([
      ...scores,
      ...(draft.winner === null ? [] : [['winner', draft.winner]]),
      ...(definition.written.reason ? [['reason', draft.reason]] : []),
    ]);
  }, [definition, subjects, draft]);
  return (
    <fieldset disabled={preview} className="flex min-w-0 flex-col gap-5">
      <legend className="sr-only">Ballot</legend>
      <BallotFields
        plan={plan}
        values={values}
        error={undefined}
        pending={false}
        reasonAudienceLabel={reasonReaders}
      />
    </fieldset>
  );
}
