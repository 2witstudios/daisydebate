'use client';

import {
  ballotCategories,
  ballotDefaultScore,
  ballotLimits,
  debateSides,
  isLowPointWin,
  speakerTotal,
  type BallotCategory,
} from '@daisy/protocol';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Side } from '../../../features/debates/turns';
import {
  feedbackField,
  readScore,
  scoreField,
  type BallotDebaters,
} from '../../../features/judge/ballot';
import { formValues } from '../../../features/mock-form/form';
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

const textareaClass =
  'w-full min-w-0 rounded-md border border-border bg-surface-raised p-3 text-base text-ink';
const checkClass = 'size-5 shrink-0 accent-accent';
/** The refusal takes focus once it renders, so a keyboard user lands on it. */
const REFUSAL_ID = 'ballot-refusal';

const readSide = (value: string | undefined): Side | null =>
  debateSides.find((side) => side === value) ?? null;

/** The sheet as posted last time, or every score at its start value. */
const postedScores = (values: Readonly<Record<string, string>>): SheetScores =>
  Object.fromEntries(
    debateSides.map((side) => [
      side,
      Object.fromEntries(
        ballotCategories.map((category) => [
          category,
          readScore(values[scoreField(side, category)]) ?? ballotDefaultScore,
        ]),
      ),
    ]),
  ) as SheetScores;

/** A result the judge confirms: who won, on which totals. */
const resultKey = (winner: Side | null, scores: SheetScores): string =>
  `${winner ?? 'none'}:${speakerTotal(scores.affirmative)}:${speakerTotal(scores.negative)}`;

const noSubscription = () => () => {};

/**
 * The ballot's fields, rendered from the answer so far: the last posted
 * values after a refusal, or a fresh sheet. The controls are uncontrolled,
 * seeded from those values, so a refusal restores what was posted with or
 * without JavaScript; state only drives the read-outs that follow them.
 * A judge can pick and score before the page hydrates, so on mount the
 * read-outs start from what the controls hold, not from the answer.
 */
export function BallotFields({
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
  const live = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const posted = postedScores(values);
  const postedWinner = readSide(values['winner']);
  const [winner, setWinner] = useState<Side | null>(postedWinner);
  const [scores, setScores] = useState<SheetScores>(posted);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = root.current?.closest('form');
    if (!form) return;
    const held = formValues(new FormData(form));
    setWinner(readSide(held['winner']));
    setScores(postedScores(held));
  }, []);
  const setScore = (side: Side, category: BallotCategory, score: number) =>
    setScores((current) => ({
      ...current,
      [side]: { ...current[side], [category]: score },
    }));
  const loser = winner === 'affirmative' ? 'negative' : 'affirmative';
  const lowPoint = winner !== null && isLowPointWin(winner, scores);
  const result = resultKey(winner, scores);
  // A confirmation carries over only for the result it was given for.
  const confirmed =
    values['low-point'] === 'confirmed' &&
    result === resultKey(postedWinner, posted);
  return (
    <div ref={root} className="contents">
      <section aria-labelledby="ballot-winner" className={ballotSectionClass}>
        <h2 id="ballot-winner" className={ballotHeadingClass}>
          Who won?
        </h2>
        <WinnerChoice
          debaters={debaters}
          initial={postedWinner}
          onPick={setWinner}
        />
      </section>

      <section aria-labelledby="ballot-scores" className={ballotSectionClass}>
        <h2 id="ballot-scores" className={ballotHeadingClass}>
          Speaker scores
        </h2>
        <ScoreSheet
          debaters={debaters}
          initial={posted}
          scores={scores}
          live={live}
          onScore={setScore}
        />
        {lowPoint ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-hue-clay-soft px-4 py-3">
            <p className="font-strong text-ink">
              {`${debaters[winner].name} wins with fewer points: ${speakerTotal(scores[winner])} to ${speakerTotal(scores[loser])}`}
            </p>
            <label className="flex items-center gap-3 font-strong text-ink">
              <input
                key={result}
                type="checkbox"
                name="low-point"
                value="confirmed"
                defaultChecked={confirmed}
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
          {debateSides.map((side) => (
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

      <div id={REFUSAL_ID} tabIndex={-1}>
        <FormError error={error} />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass('primary')}
        >
          {pending ? 'Submitting…' : 'Submit ballot'}
        </button>
        {live ? (
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
        ) : null}
      </div>
    </div>
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
      focusOnRefusal={REFUSAL_ID}
    >
      {(body) => <BallotFields debaters={debaters} {...body} />}
    </MockForm>
  );
}
