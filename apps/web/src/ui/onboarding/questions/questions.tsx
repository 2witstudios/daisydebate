'use client';

import { useState, type ReactNode } from 'react';
import {
  clubChoices,
  experienceChoices,
  formatChoices,
  lengthChoices,
  topicChoices,
  wantChoices,
} from '@daisy/protocol';
import type { OnboardingAnswers } from '../../../features/onboarding/answers';
import { Icon } from '../../components/icon/icon';
import { Notice } from '../../components/notice/notice';
import { NextButton, OnboardingFrame, StepFooter } from '../frame/frame';
import {
  clubLabels,
  experienceLabels,
  formatLabels,
  lengthLabels,
  topicLabels,
  wantLabels,
} from './labels';

export type QuestionStepProps = {
  readonly answers: OnboardingAnswers;
  /** The form's action (a server action, or useFormAction's wrapper). */
  readonly action: string | ((form: FormData) => void);
  readonly pending: boolean;
  /** Set when the last post was refused or never arrived. */
  readonly refused?: boolean;
  readonly backHref: string;
  readonly skip: ReactNode;
};

const heading =
  'font-display text-2xl leading-tight font-semibold tracking-tight text-ink';
const legend = 'mb-3 p-0 text-sm font-strong text-ink-muted';
const tile =
  'group flex min-h-onboarding-tile cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-surface-raised px-4 text-md font-strong text-ink has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-wait';
const chip =
  'flex min-h-onboarding-touch cursor-pointer items-center rounded-round border border-border bg-surface-raised px-4 text-base font-strong text-ink has-checked:border-accent has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-wait';

function Choice<T extends string>({
  type,
  name,
  value,
  label,
  checked,
  disabled,
  look,
  onChange,
}: {
  readonly type: 'checkbox' | 'radio';
  readonly name: string;
  readonly value: T;
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly look: 'tile' | 'chip';
  readonly onChange?: (checked: boolean) => void;
}) {
  return (
    <label className={look === 'tile' ? tile : chip}>
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={checked}
        disabled={disabled}
        className="sr-only"
        onChange={
          onChange === undefined
            ? undefined
            : (event) => onChange(event.currentTarget.checked)
        }
      />
      <span>{label}</span>
      {look === 'tile' ? (
        <Icon
          name="check"
          size={18}
          className="invisible shrink-0 group-has-checked:visible"
        />
      ) : null}
    </label>
  );
}

function StepForm({
  step,
  title,
  aside,
  action,
  pending,
  refused,
  backHref,
  skip,
  stepNumber,
  finish = false,
  children,
}: Omit<QuestionStepProps, 'answers'> & {
  readonly step: 'about' | 'experience' | 'topics';
  readonly title: string;
  readonly aside?: ReactNode;
  readonly stepNumber: number;
  readonly finish?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <OnboardingFrame step={stepNumber} titleId="onboarding-title" skip={skip}>
      <form
        action={action}
        aria-busy={pending}
        aria-labelledby="onboarding-title"
        className="flex flex-1 flex-col gap-8"
      >
        <input type="hidden" name="step" value={step} />
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 id="onboarding-title" tabIndex={-1} className={heading}>
            {title}
          </h1>
          {aside}
        </div>
        {refused ? (
          <Notice
            tone="gold"
            icon="alert"
            role="status"
            title="Your answers weren’t saved. Try again."
          />
        ) : null}
        {children}
        <StepFooter
          backHref={backHref}
          next={
            <NextButton pending={pending}>
              {finish ? 'Finish' : 'Next'}
            </NextButton>
          }
        />
      </form>
    </OnboardingFrame>
  );
}

/** Step 4: what the member wants to do here, and their club. */
export function AboutStep({ answers, ...rest }: QuestionStepProps) {
  return (
    <StepForm step="about" title="About you" stepNumber={4} {...rest}>
      <fieldset className="m-0 border-0 p-0">
        <legend className={legend}>I want to</legend>
        <div className="grid grid-cols-4 gap-3 max-narrow:grid-cols-2">
          {wantChoices.map((want) => (
            <Choice
              key={want}
              type="checkbox"
              name="wants"
              value={want}
              label={wantLabels[want]}
              checked={answers.wants.includes(want)}
              disabled={rest.pending}
              look="tile"
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="m-0 border-0 p-0">
        <legend className={legend}>Club</legend>
        <div className="grid grid-cols-3 gap-3 max-narrow:grid-cols-1">
          {clubChoices.map((club) => (
            <Choice
              key={club}
              type="radio"
              name="club"
              value={club}
              label={clubLabels[club]}
              checked={answers.club === club}
              disabled={rest.pending}
              look="tile"
            />
          ))}
        </div>
      </fieldset>
    </StepForm>
  );
}

/** Step 5: experience, formats and length. */
export function ExperienceStep({ answers, ...rest }: QuestionStepProps) {
  return (
    <StepForm step="experience" title="Experience" stepNumber={5} {...rest}>
      <fieldset className="m-0 border-0 p-0">
        <legend className={legend}>Debating so far</legend>
        <div className="grid grid-cols-2 gap-3 max-narrow:grid-cols-1">
          {experienceChoices.map((experience) => (
            <Choice
              key={experience}
              type="radio"
              name="experience"
              value={experience}
              label={experienceLabels[experience]}
              checked={answers.experience === experience}
              disabled={rest.pending}
              look="tile"
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-8">
        <fieldset className="m-0 border-0 p-0">
          <legend className={legend}>Formats</legend>
          <div className="flex flex-wrap gap-3">
            {formatChoices.map((format) => (
              <Choice
                key={format}
                type="checkbox"
                name="formats"
                value={format}
                label={formatLabels[format]}
                checked={answers.formats.includes(format)}
                disabled={rest.pending}
                look="chip"
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="m-0 border-0 p-0">
          <legend className={legend}>Length</legend>
          <div className="flex flex-wrap gap-3">
            {lengthChoices.map((length) => (
              <Choice
                key={length}
                type="radio"
                name="length"
                value={length}
                label={lengthLabels[length]}
                checked={answers.length === length}
                disabled={rest.pending}
                look="chip"
              />
            ))}
          </div>
        </fieldset>
      </div>
    </StepForm>
  );
}

/** Step 6: the topics the member wants to argue. */
export function TopicsStep({ answers, ...rest }: QuestionStepProps) {
  const [picked, setPicked] = useState(answers.topics.length);
  return (
    <StepForm
      step="topics"
      title="Topics"
      stepNumber={6}
      finish
      aside={
        <p className="text-sm text-ink-muted tabular-nums" aria-live="polite">
          {`${picked} selected`}
        </p>
      }
      {...rest}
    >
      <div
        role="group"
        aria-labelledby="onboarding-title"
        className="flex flex-wrap gap-3"
      >
        {topicChoices.map((topic) => (
          <Choice
            key={topic}
            type="checkbox"
            name="topics"
            value={topic}
            label={topicLabels[topic]}
            checked={answers.topics.includes(topic)}
            disabled={rest.pending}
            look="chip"
            onChange={(checked) =>
              setPicked((count) => count + (checked ? 1 : -1))
            }
          />
        ))}
      </div>
    </StepForm>
  );
}
