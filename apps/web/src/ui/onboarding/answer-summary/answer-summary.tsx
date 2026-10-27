import Link from 'next/link';
import { onboardingStepHref } from '../../../features/access/decision';
import type { OnboardingAnswers } from '../../../features/onboarding/answers';
import {
  clubLabels,
  experienceLabels,
  formatLabels,
  topicLabels,
  wantLabels,
} from '../questions/labels';

/** Where each answer is changed: the onboarding step that asks it. */
export type AnswerEditHrefs = {
  readonly about: string;
  readonly experience: string;
  readonly topics: string;
};

/** Each answer's step, returning to `destination` once it is saved. */
export const answerEditHrefs = (destination: string): AnswerEditHrefs => ({
  about: onboardingStepHref('about', destination),
  experience: onboardingStepHref('experience', destination),
  topics: onboardingStepHref('topics', destination),
});

const none = '—';

/**
 * A member's optional onboarding answers, each with an Edit link to the
 * step that asks it (ISSUE-324). Plain links, so it works without
 * JavaScript. Shown on the Ready step and in Settings.
 */
export function AnswerSummary({
  answers,
  editHrefs,
}: {
  readonly answers: OnboardingAnswers;
  readonly editHrefs: AnswerEditHrefs;
}) {
  const rows = [
    [
      'Wants to',
      answers.wants.map((want) => wantLabels[want]).join(', '),
      editHrefs.about,
    ],
    [
      'Club',
      answers.club === null ? '' : clubLabels[answers.club],
      editHrefs.about,
    ],
    [
      'Experience',
      answers.experience === null ? '' : experienceLabels[answers.experience],
      editHrefs.experience,
    ],
    [
      'Formats',
      answers.formats.map((format) => formatLabels[format]).join(' · '),
      editHrefs.experience,
    ],
    [
      'Topics',
      answers.topics.map((topic) => topicLabels[topic]).join(', '),
      editHrefs.topics,
    ],
  ] as const;
  return (
    <dl className="m-0 flex flex-col border-t border-border">
      {rows.map(([label, value, edit]) => (
        <div
          key={label}
          className="flex min-h-onboarding-touch items-center gap-4 border-b border-border"
        >
          <dt className="w-onboarding-label shrink-0 text-sm text-ink-muted">
            {label}
          </dt>
          <dd className="m-0 flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="min-w-0 text-base font-strong text-ink">
              {value === '' ? none : value}
            </span>
            <Link
              href={edit}
              aria-label={`Edit ${label.toLowerCase()}`}
              className="inline-flex min-h-onboarding-touch shrink-0 items-center px-2 text-sm font-strong"
            >
              Edit
            </Link>
          </dd>
        </div>
      ))}
    </dl>
  );
}
