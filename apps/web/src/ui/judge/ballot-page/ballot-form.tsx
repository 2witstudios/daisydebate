'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { feedbackField } from '../../../features/judge/ballot';
import type { BallotPlan } from '../../../features/judge/ballot-plan';
import {
  lowPointOf,
  postedSheet,
  type SheetScores,
} from '../../../features/judge/ballot-sheet';
import { formValues } from '../../../features/forms/form-state';
import { formatCountdown } from '../../../lib/clock-display';
import {
  ballotHeadingClass,
  ballotSectionClass,
} from '../../ballot/ballot-class';
import { firstName } from '../../ballot/ballot-labels';
import { RankingChoice } from '../../ballot/ranking-choice/ranking-choice';
import { ScoreSheet } from '../../ballot/score-sheet/score-sheet';
import { WinnerChoice } from '../../ballot/winner-choice/winner-choice';
import { buttonClass } from '../../components/button/button-class';
import { FormError, FormField } from '../../components/form-field/form-field';
import { DecisionChoice } from './decision-choice';

const textareaClass =
  'w-full min-w-0 rounded-md border border-border bg-surface-raised p-3 text-base text-ink';
const checkClass = 'size-5 shrink-0 accent-accent';
/** The refusal takes focus once it renders, so a keyboard user lands on it. */
const REFUSAL_ID = 'ballot-refusal';
const OPENS_ID = 'ballot-opens-in';

const readSide = (plan: BallotPlan, value: string | undefined): string | null =>
  plan.decided.find((subject) => subject.key === value)?.key ?? null;

const noSubscription = () => () => {};

/** Who reads the reason: both debaters of a two-sided Round, or every one. */
const reasonReaders = (plan: BallotPlan) =>
  plan.decided.length === 2
    ? 'Both debaters see this.'
    : 'Every debater sees this.';

/** A length limit, said as optional when the definition does not require it. */
const limitHelper = (limit: {
  readonly required: boolean;
  readonly max: number;
}) => `${limit.required ? '' : 'Optional. '}Up to ${limit.max} characters.`;

/**
 * The ballot's fields, rendered from the answer so far: the last posted
 * values after a refusal, or a fresh sheet. The controls are uncontrolled,
 * seeded from those values, so a refusal restores what was posted with or
 * without JavaScript; state only drives the read-outs that follow them.
 * A judge can pick and score before the page hydrates, so on mount the
 * read-outs start from what the controls hold, not from the answer. What
 * is asked, and of whom, is the Round's own ballot definition (TAB-6.17).
 */
export function BallotFields({
  plan,
  values,
  error,
  pending,
  errorId = REFUSAL_ID,
  opensInMs = null,
  reasonAudienceLabel,
}: {
  readonly plan: BallotPlan;
  readonly values: Readonly<Record<string, string>>;
  readonly error: string | undefined;
  readonly pending: boolean;
  readonly errorId?: string;
  /** While attendance settles, Submit waits, but only with script: a native post always submits. */
  readonly opensInMs?: number | null;
  readonly reasonAudienceLabel?: string;
}) {
  const live = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const { decision, points, written } = plan.definition;
  const reasonRule = written.reason;
  const feedbackRule = written.feedback;
  const posted = postedSheet(plan, values);
  const postedWinner = readSide(plan, values['winner']);
  const [winner, setWinner] = useState<string | null>(postedWinner);
  const [scores, setScores] = useState<SheetScores>(posted);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = root.current?.closest('form');
    if (!form) return;
    const held = formValues(new FormData(form));
    setWinner(readSide(plan, held['winner']));
    setScores(postedSheet(plan, held));
  }, [plan]);
  const setScore = (subject: string, row: string, score: number) =>
    setScores((current) => ({
      ...current,
      [subject]: { ...current[subject], [row]: score },
    }));
  const winnerDecision = decision.kind === 'winner';
  const lowPoint = lowPointOf(plan, winner, scores);
  const winnerName =
    plan.decided.find((subject) => subject.key === winner)?.name ?? null;
  return (
    <div ref={root} className="contents">
      <div id={errorId} tabIndex={-1} className="empty:hidden">
        <FormError error={error} />
      </div>
      <DecisionSection
        plan={plan}
        values={values}
        initialWinner={postedWinner}
        onPick={setWinner}
      />

      {plan.definition.speakerRanks ? (
        <section
          aria-labelledby="ballot-speaker-ranks"
          className={ballotSectionClass}
        >
          <h2 id="ballot-speaker-ranks" className={ballotHeadingClass}>
            Speaker ranks
          </h2>
          <RankingChoice
            subjects={plan.speakers}
            values={values}
            kind="speakers"
          />
        </section>
      ) : null}
      {points ? (
        <section aria-labelledby="ballot-scores" className={ballotSectionClass}>
          <h2 id="ballot-scores" className={ballotHeadingClass}>
            {points.per === 'speech' ? 'Speech scores' : 'Speaker scores'}
          </h2>
          <ScoreSheet
            points={points}
            subjects={plan.scored}
            initial={posted}
            scores={scores}
            live={live}
            onScore={setScore}
          />
          {lowPoint ? (
            <LowPointConfirm
              lowPoint={lowPoint}
              confirmed={values['low-point'] === lowPoint.key}
            />
          ) : null}
        </section>
      ) : null}

      {reasonRule || feedbackRule ? (
        <section
          aria-labelledby="ballot-written"
          className={ballotSectionClass}
        >
          <h2 id="ballot-written" className={ballotHeadingClass}>
            Decision and feedback
          </h2>
          {reasonRule ? (
            <FormField
              id="ballot-reason"
              label="Reason for decision"
              helper={`${reasonAudienceLabel ?? reasonReaders(plan)} ${limitHelper(reasonRule)}`}
            >
              {/* No required attribute: a missing reason posts, and the
                  server refuses it keeping everything entered (ISSUE-348). */}
              <textarea
                id="ballot-reason"
                name="reason"
                rows={4}
                maxLength={reasonRule.max}
                aria-required={reasonRule.required}
                defaultValue={values['reason'] ?? ''}
                aria-describedby="ballot-reason-helper"
                className={textareaClass}
              />
            </FormField>
          ) : null}
          {feedbackRule ? (
            <div className="grid grid-cols-2 gap-4 max-narrow:grid-cols-1">
              {plan.decided.map((subject) => (
                <FormField
                  key={subject.key}
                  id={`ballot-${feedbackField(subject.key)}`}
                  label={`Feedback for ${firstName(subject.name)}`}
                  helper={limitHelper(feedbackRule)}
                >
                  <textarea
                    id={`ballot-${feedbackField(subject.key)}`}
                    name={feedbackField(subject.key)}
                    rows={3}
                    maxLength={feedbackRule.max}
                    aria-required={feedbackRule.required}
                    defaultValue={values[feedbackField(subject.key)] ?? ''}
                    aria-describedby={`ballot-${feedbackField(subject.key)}-helper`}
                    className={textareaClass}
                  />
                </FormField>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <SubmitRow
        pending={pending}
        live={live}
        opensInMs={opensInMs}
        vote={winnerDecision ? { name: winnerName } : null}
      />
    </div>
  );
}

/** The decision the definition asks for: a winner (or a tie or double loss where allowed), or the places. */
function DecisionSection({
  plan,
  values,
  initialWinner,
  onPick,
}: {
  readonly plan: BallotPlan;
  readonly values: Readonly<Record<string, string>>;
  readonly initialWinner: string | null;
  readonly onPick: (side: string) => void;
}) {
  const { decision } = plan.definition;
  return (
    <section aria-labelledby="ballot-winner" className={ballotSectionClass}>
      <h2 id="ballot-winner" className={ballotHeadingClass}>
        {decision.kind === 'winner' ? 'Who won?' : 'Who placed where?'}
      </h2>
      {decision.kind === 'winner' ? (
        <>
          {decision.tie || decision.doubleLoss ? (
            <DecisionChoice
              tie={decision.tie}
              doubleLoss={decision.doubleLoss}
              initial={values['decision'] ?? 'win'}
            />
          ) : null}
          <WinnerChoice
            sides={plan.decided}
            initial={initialWinner}
            onPick={onPick}
          />
        </>
      ) : (
        <RankingChoice
          subjects={plan.decided}
          values={values}
          ties={decision.ties}
        />
      )}
    </section>
  );
}

/** A win on fewer points, confirmed for this result only. */
function LowPointConfirm({
  lowPoint,
  confirmed,
}: {
  readonly lowPoint: { readonly text: string; readonly key: string };
  readonly confirmed: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-hue-clay-soft px-4 py-3">
      <p className="font-strong text-ink">{lowPoint.text}</p>
      <label className="flex items-center gap-3 font-strong text-ink">
        <input
          key={lowPoint.key}
          type="checkbox"
          name="low-point"
          value={lowPoint.key}
          defaultChecked={confirmed}
          className={checkClass}
        />
        Confirm the decision
      </label>
    </div>
  );
}

/** Submit, the wait while attendance settles (script only), and the vote read-out. */
function SubmitRow({
  pending,
  live,
  opensInMs,
  vote,
}: {
  readonly pending: boolean;
  readonly live: boolean;
  readonly opensInMs: number | null;
  /** The winner picked so far, on a winner ballot; null on a ranking. */
  readonly vote: { readonly name: string | null } | null;
}) {
  const waiting = live && opensInMs !== null;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        type="submit"
        disabled={pending || waiting}
        aria-describedby={waiting ? OPENS_ID : undefined}
        className={buttonClass('primary')}
      >
        {pending ? 'Submitting…' : 'Submit ballot'}
      </button>
      {waiting ? (
        <p id={OPENS_ID} className="text-base text-ink-muted">
          {`Opens in ${formatCountdown(opensInMs)}`}
        </p>
      ) : null}
      {live && vote ? (
        <p className="text-base text-ink-muted">
          {vote.name === null ? (
            'No winner picked'
          ) : (
            <>
              Your vote:{' '}
              <span className="font-strong text-ink">{`${vote.name} wins`}</span>
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
