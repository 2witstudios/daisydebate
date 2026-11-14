'use client';

import { useState } from 'react';
import {
  ballotProblem,
  pointsScaleLabel,
  scoreKey,
  subjectTotal,
  type BallotDefinition,
  type BallotDraft,
  type BallotSubject,
  type WrittenRule,
} from '../../../features/tab/ballot-definition';
import { cn } from '../../cn';
import { Button } from '../../components/button/button';
import { buttonClass } from '../../components/button/button-class';
import {
  controlClass,
  errorClass,
  fieldClass,
  helperClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import { inlineSelectClass } from '../choice-field/choice-field';
import { eyebrowClass } from '../list-card/list-card';

const DOUBLE_LOSS = 'double-loss';

const optional = (rule: WrittenRule) =>
  rule === 'optional' ? ' (optional)' : '';

const ordinal = (place: number): string =>
  place === 1
    ? '1st'
    : place === 2
      ? '2nd'
      : place === 3
        ? '3rd'
        : `${place}th`;

const choiceClass =
  'flex cursor-pointer items-center gap-3 rounded-lg border border-border-strong bg-surface-raised p-3 has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink';

function Stepper({
  label,
  value,
  onStep,
  disabled,
}: {
  readonly label: string;
  readonly value: number;
  readonly onStep: (direction: 1 | -1) => void;
  readonly disabled: boolean;
}) {
  const step = cn(buttonClass('secondary'), 'size-nav-target px-0 py-0');
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={step}
        aria-label={`Lower ${label}`}
        disabled={disabled}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <output
        aria-label={label}
        className="w-tab-points text-center font-display text-xl font-bold tabular-nums"
      >
        {value}
      </output>
      <button
        type="button"
        className={step}
        aria-label={`Raise ${label}`}
        disabled={disabled}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </div>
  );
}

/**
 * A judge's ballot drawn from a ballot definition and nothing else: who won
 * and the outcomes the event allows, ranks, points on the event's scale (one
 * score or a criteria grid), and the written fields the host asked for.
 * `preview` shows it as a host's sample: the same ballot, with no control
 * that can be used.
 */
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
  const [winner, setWinner] = useState(draft.winner);
  const [points, setPoints] = useState(draft.points);
  const scale = definition.points;
  const problem = ballotProblem(definition, subjects, { winner, points });
  const step = (key: string, direction: 1 | -1) => {
    if (scale === null) return;
    setPoints((current) => ({
      ...current,
      [key]: Math.min(
        scale.max,
        Math.max(
          scale.min,
          (current[key] ?? scale.min) + direction * scale.step,
        ),
      ),
    }));
  };
  const criteria =
    definition.criteria.length === 0 ? [null] : definition.criteria;
  return (
    <fieldset disabled={preview} className="flex min-w-0 flex-col gap-5">
      <legend className="sr-only">Ballot</legend>
      {definition.outcomes.winner ? (
        <fieldset className="flex flex-col gap-2">
          <legend className={cn('mb-2', eyebrowClass)}>Who won?</legend>
          {subjects.map((subject) => (
            <label key={subject.id} className={choiceClass}>
              <input
                type="radio"
                name="winner"
                value={subject.id}
                checked={winner === subject.id}
                onChange={() => setWinner(subject.id)}
              />
              <span>
                <strong className="font-strong">{subject.name}</strong>
                {subject.role === null ? null : ` · ${subject.role}`}
              </span>
            </label>
          ))}
          {definition.outcomes.doubleLoss ? (
            <label className={choiceClass}>
              <input
                type="radio"
                name="winner"
                value={DOUBLE_LOSS}
                checked={winner === DOUBLE_LOSS}
                onChange={() => setWinner(DOUBLE_LOSS)}
              />
              <span>Neither · double loss</span>
            </label>
          ) : null}
        </fieldset>
      ) : null}
      {definition.ranks ? (
        <fieldset className="flex flex-col gap-2">
          <legend className={cn('mb-2', eyebrowClass)}>
            Ranks · 1st to {ordinal(subjects.length)}
          </legend>
          {subjects.map((subject, index) => (
            <div
              key={subject.id}
              className="flex items-center justify-between gap-3"
            >
              <label htmlFor={`rank-${subject.id}`} className="min-w-0">
                <strong className="font-strong">{subject.name}</strong>
                {subject.role === null ? null : (
                  <span className="text-ink-muted"> · {subject.role}</span>
                )}
              </label>
              <select
                id={`rank-${subject.id}`}
                name={`rank-${subject.id}`}
                defaultValue={ordinal(index + 1)}
                className={inlineSelectClass}
              >
                {subjects.map((_, place) => (
                  <option key={ordinal(place + 1)}>{ordinal(place + 1)}</option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
      ) : null}
      {scale === null ? null : (
        <fieldset className="flex flex-col gap-3">
          <legend className={cn('mb-2', eyebrowClass)}>
            Speaker points · {pointsScaleLabel(scale)}
          </legend>
          {subjects.map((subject) => (
            <div key={subject.id} className="flex flex-col gap-2">
              {criteria.map((criterion) => (
                <div
                  key={criterion ?? subject.id}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="min-w-0">
                    <strong className="font-strong">{subject.name}</strong>
                    {criterion === null ? null : ` · ${criterion}`}
                  </span>
                  <Stepper
                    label={
                      criterion === null
                        ? `${subject.name}'s points`
                        : `${subject.name}'s points for ${criterion.toLowerCase()}`
                    }
                    value={points[scoreKey(subject.id, criterion)] ?? scale.min}
                    disabled={preview}
                    onStep={(direction) =>
                      step(scoreKey(subject.id, criterion), direction)
                    }
                  />
                </div>
              ))}
              {definition.criteria.length === 0 ? null : (
                <p className="text-right text-sm text-ink-muted tabular-nums">
                  {subject.name} ·{' '}
                  {subjectTotal(definition, points, subject.id)} in all
                </p>
              )}
            </div>
          ))}
          {problem === null ? null : (
            <p
              role="alert"
              className={cn('rounded-lg bg-live-soft px-3 py-2', errorClass)}
            >
              {problem}
            </p>
          )}
        </fieldset>
      )}
      {definition.written.reason === 'off' ? null : (
        <div className={fieldClass}>
          <label htmlFor="ballot-reason" className={labelClass}>
            Reason for decision{optional(definition.written.reason)}
          </label>
          <textarea
            id="ballot-reason"
            name="reason"
            rows={3}
            defaultValue={draft.reason}
            required={definition.written.reason === 'required'}
            aria-describedby="ballot-reason-helper"
            className={cn(controlClass, 'h-auto py-2')}
          />
          <p id="ballot-reason-helper" className={helperClass}>
            {reasonReaders}
          </p>
        </div>
      )}
      {definition.written.feedback === 'off'
        ? null
        : subjects.map((subject) => (
            <div key={subject.id} className={fieldClass}>
              <label htmlFor={`feedback-${subject.id}`} className={labelClass}>
                Feedback for {subject.name}
                {optional(definition.written.feedback)}
              </label>
              <input
                id={`feedback-${subject.id}`}
                name={`feedback-${subject.id}`}
                type="text"
                required={definition.written.feedback === 'required'}
                className={controlClass}
              />
            </div>
          ))}
      {definition.written.privateNote === 'off' ? null : (
        <div className={fieldClass}>
          <label htmlFor="ballot-private-note" className={labelClass}>
            Private note to tab{optional(definition.written.privateNote)}
          </label>
          <input
            id="ballot-private-note"
            name="privateNote"
            type="text"
            className={controlClass}
          />
        </div>
      )}
      <Button type="submit" disabled={preview || problem !== null}>
        Submit ballot
      </Button>
    </fieldset>
  );
}
