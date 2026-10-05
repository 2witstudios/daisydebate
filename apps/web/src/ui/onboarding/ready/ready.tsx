import Link from 'next/link';
import type { OnboardingAnswers } from '../../../features/onboarding/answers';
import { Icon } from '../../components/icon/icon';
import { SampleAction } from '../../components/sample-action/sample-action';
import { SampleActionNotice } from '../../components/sample-action/sample-action-notice';
import { OnboardingFrame } from '../frame/frame';
import {
  clubLabels,
  experienceLabels,
  formatLabels,
  lengthLabels,
  topicLabels,
  wantLabels,
} from '../questions/labels';

export type ReadyStepProps = {
  readonly answers: OnboardingAnswers;
  /** The Train bots by name, for the bot card. */
  readonly botNames: readonly string[];
  readonly homeHref: string;
  readonly editHrefs: {
    readonly about: string;
    readonly experience: string;
    readonly topics: string;
  };
};

const none = '—';

/** "Juno, Wren or Bram". */
const orList = (names: readonly string[]) =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;

/** The club row's action, or null when the member has no club plans. */
export function clubAction(answers: OnboardingAnswers): string | null {
  if (answers.club === 'starting' || answers.wants.includes('coach'))
    return 'Create your club';
  if (answers.club === 'joining') return 'Join your club';
  return null;
}

const card =
  'flex min-h-onboarding-cta flex-1 basis-onboarding-col flex-col justify-between gap-3 rounded-lg border-2 border-accent px-6 py-5 no-underline hover:no-underline';

/** The last step: start a first debate, and the answers to edit. */
export function ReadyStep({
  answers,
  botNames,
  homeHref,
  editHrefs,
}: ReadyStepProps) {
  const club = clubAction(answers);
  const summary = [
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
      [
        ...answers.formats.map((format) => formatLabels[format]),
        ...(answers.length === null ? [] : [lengthLabels[answers.length]]),
      ].join(' · '),
      editHrefs.experience,
    ],
    [
      'Topics',
      answers.topics.map((topic) => topicLabels[topic]).join(', '),
      editHrefs.topics,
    ],
  ] as const;
  return (
    <OnboardingFrame step={null} titleId="onboarding-title">
      <SampleActionNotice />
      <h1
        id="onboarding-title"
        tabIndex={-1}
        className="font-display text-2xl leading-tight font-semibold tracking-tight text-ink"
      >
        Your first debate
      </h1>
      <div className="flex flex-wrap gap-3">
        <Link href="/train" className={`${card} bg-surface-raised text-ink`}>
          <span className="flex items-center gap-3 font-display text-2xl font-semibold">
            <Icon name="bolt" size={22} />
            Debate a bot
          </span>
          <span className="text-base text-ink-muted">{orList(botNames)}</span>
        </Link>
        <Link href="/play" className={`${card} bg-accent text-accent-ink`}>
          <span className="flex items-center gap-3 font-display text-2xl font-semibold">
            <Icon name="users" size={22} />
            Debate a real person
          </span>
          <span className="text-base">Ranked or casual</span>
        </Link>
      </div>
      {club === null ? null : (
        <SampleAction
          label={club}
          className="flex min-h-onboarding-touch items-center rounded-md bg-surface-sunken px-5 text-md font-strong text-ink"
        >
          {club}
        </SampleAction>
      )}
      <dl className="m-0 flex flex-col border-t border-border">
        {summary.map(([label, value, edit]) => (
          <div
            key={label}
            className="flex min-h-onboarding-touch items-center gap-4 border-b border-border"
          >
            <dt className="w-onboarding-label shrink-0 text-sm text-ink-muted">
              {label}
            </dt>
            <dd className="m-0 min-w-0 flex-1 text-base font-strong text-ink">
              {value === '' ? none : value}
            </dd>
            <Link
              href={edit}
              aria-label={`Edit ${label.toLowerCase()}`}
              className="inline-flex min-h-onboarding-touch items-center px-2 text-sm font-strong"
            >
              Edit
            </Link>
          </div>
        ))}
      </dl>
      <Link
        href={homeHref}
        className="inline-flex min-h-onboarding-touch items-center self-start text-base font-strong"
      >
        Go to home
      </Link>
    </OnboardingFrame>
  );
}
