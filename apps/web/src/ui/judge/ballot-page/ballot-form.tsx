'use client';

import {
  ballotCategories,
  ballotDefaultScore,
  ballotLimits,
  isLowPointWin,
  speakerTotal,
  type BallotCategory,
} from '@daisy/protocol';
import { useState } from 'react';
import type { Side } from '../../../features/debates/turns';
import {
  feedbackField,
  scoreField,
  type BallotDebaters,
} from '../../../features/judge/ballot';
import {
  ballotHeadingClass,
  ballotSectionClass,
} from '../../ballot/ballot-class';
import { firstName } from '../../ballot/ballot-labels';
import {
  ScoreSheet,
  type SheetScores,
} from '../../ballot/score-sheet/score-sheet';
import { WinnerChoice } from '../../ballot/winner-choice/winner-choice';
import { buttonClass } from '../../components/button/button-class';
import { FormError, FormField } from '../../components/form-field/form-field';
import { MockForm, type MockFormAction } from '../../form-action/mock-form';

const sides = ['affirmative', 'negative'] as const satisfies readonly Side[];
const textareaClass =
  'w-full min-w-0 rounded-md border border-border bg-surface-raised p-3 text-base text-ink';
const checkClass = 'size-5 shrink-0 accent-accent';

const readSide = (value: string | undefined): Side | null =>
  sides.find((side) => side === value) ?? null;

const readScore = (value: string | undefined): number => {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 5
    ? score
    : ballotDefaultScore;
};

/** The sheet as posted last time, or every score at its start value. */
const initialScores = (values: Readonly<Record<string, string>>): SheetScores =>
  Object.fromEntries(
    sides.map((side) => [
      side,
      Object.fromEntries(
        ballotCategories.map((category) => [
          category,
          readScore(values[scoreField(side, category)]),
        ]),
      ),
    ]),
  ) as SheetScores;

function BallotBody({
  debaters,
  values,
  error,
  pending,
}: {
  readonly debaters: BallotDebaters;
  readonly values: Readonly<Record<string, string>>;
  readonly error: string | undefined;
  readonly pending: boolean;
}) {
  const [winner, setWinner] = useState<Side | null>(() =>
    readSide(values['winner']),
  );
  const [scores, setScores] = useState<SheetScores>(() =>
    initialScores(values),
  );
  const setScore = (side: Side, category: BallotCategory, score: number) =>
    setScores((current) => ({
      ...current,
      [side]: { ...current[side], [category]: score },
    }));
  const loser = winner === 'affirmative' ? 'negative' : 'affirmative';
  const lowPoint = winner !== null && isLowPointWin(winner, scores);
  return (
    <>
      <section aria-labelledby="ballot-winner" className={ballotSectionClass}>
        <h2 id="ballot-winner" className={ballotHeadingClass}>
          Who won?
        </h2>
        <WinnerChoice debaters={debaters} winner={winner} onPick={setWinner} />
      </section>

      <section aria-labelledby="ballot-scores" className={ballotSectionClass}>
        <h2 id="ballot-scores" className={ballotHeadingClass}>
          Speaker scores
        </h2>
        <ScoreSheet debaters={debaters} scores={scores} onScore={setScore} />
        {lowPoint && winner !== null ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-hue-clay-soft px-4 py-3">
            <p className="font-strong text-ink">
              {`${debaters[winner].name} wins with fewer points: ${speakerTotal(scores[winner])} to ${speakerTotal(scores[loser])}`}
            </p>
            <label className="flex items-center gap-3 font-strong text-ink">
              <input
                type="checkbox"
                name="low-point"
                value="confirmed"
                defaultChecked={values['low-point'] === 'confirmed'}
                className={checkClass}
              />
              Confirm the decision
            </label>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="ballot-written" className={ballotSectionClass}>
        <h2 id="ballot-written" className={ballotHeadingClass}>
          Decision and feedback
        </h2>
        <FormField
          id="ballot-reason"
          label="Reason for decision"
          helper={`Both debaters see this. Up to ${ballotLimits.reason} characters.`}
        >
          <textarea
            id="ballot-reason"
            name="reason"
            rows={4}
            maxLength={ballotLimits.reason}
            defaultValue={values['reason'] ?? ''}
            aria-describedby="ballot-reason-helper"
            className={textareaClass}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4 max-narrow:grid-cols-1">
          {sides.map((side) => (
            <FormField
              key={side}
              id={`ballot-${feedbackField(side)}`}
              label={`Feedback for ${firstName(debaters[side].name)}`}
              helper={`Optional. Up to ${ballotLimits.feedback} characters.`}
            >
              <textarea
                id={`ballot-${feedbackField(side)}`}
                name={feedbackField(side)}
                rows={3}
                maxLength={ballotLimits.feedback}
                defaultValue={values[feedbackField(side)] ?? ''}
                aria-describedby={`ballot-${feedbackField(side)}-helper`}
                className={textareaClass}
              />
            </FormField>
          ))}
        </div>
        <label className="flex w-fit items-center gap-3 font-strong text-ink">
          <input
            type="checkbox"
            name="conduct"
            value="report"
            defaultChecked={values['conduct'] === 'report'}
            className={checkClass}
          />
          Report a conduct issue
        </label>
      </section>

      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          {pending ? 'Submitting…' : 'Submit ballot'}
        </button>
        <p className="text-base text-ink-muted">
          {winner === null ? (
            'No winner picked'
          ) : (
            <>
              Your vote:{' '}
              <span className="font-strong text-ink">{`${debaters[winner].name} wins`}</span>
            </>
          )}
        </p>
      </div>
    </>
  );
}

/**
 * The ballot, a real POST: it works before hydration and without
 * JavaScript, and a refusal keeps what was entered. One ballot per judge
 * seat; it cannot be sent twice.
 */
export function BallotForm({
  action,
  debaters,
}: {
  readonly action: MockFormAction;
  readonly debaters: BallotDebaters;
}) {
  return (
    <MockForm
      action={action}
      label="Your ballot"
      className="flex flex-col gap-6"
    >
      {(body) => <BallotBody debaters={debaters} {...body} />}
    </MockForm>
  );
}
