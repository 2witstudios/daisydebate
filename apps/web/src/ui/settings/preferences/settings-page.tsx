import { ConsentControls } from '../../analytics/consent-controls';
import type { AnalyticsAvailability } from '../../../features/analytics/consent';
import type { ConsentChoice } from '../../../features/analytics/viewer-analytics';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { OnboardingAnswers } from '../../../features/onboarding/answers';
import {
  AnswerSummary,
  type AnswerEditHrefs,
} from '../../onboarding/answer-summary/answer-summary';
import type { DataRightsNotices } from '../../../features/account/data-rights/notices';
import { buttonClass } from '../../components/button/button-class';
import { PageHeader } from '../../components/page-header/page-header';
import { ThemeSwitcher } from '../../components/theme-switcher/theme-switcher';
import { cn } from '../../cn';
import { DataRights } from './data-rights';

const panel =
  'flex scroll-mt-20 flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'font-display text-xl font-bold text-ink';

const nav = [
  ['profile', 'Profile'],
  ['ratings', 'Your card'],
  ['privacy', 'Privacy and data'],
  ['appearance', 'Appearance'],
  ['security', 'Security'],
] as const;

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={panel}>
      <h2 id={`${id}-heading`} className={heading}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export type SettingsPageProps = {
  /** Which ratings the member's card shows, when it could be read. */
  readonly ratingCard?: ReactNode;
  readonly username: string | null;
  readonly analytics: {
    readonly choice: ConsentChoice;
    readonly available: AnalyticsAvailability;
  };
  /** The member's data-rights notices, parsed from the handlers' fixed keys. */
  readonly dataRightsNotices: DataRightsNotices;
  /**
   * The member's optional onboarding answers and where each is changed
   * (ISSUE-324); null when they are not asked of this member (under 16, or
   * no age on record), so nothing optional is shown.
   */
  readonly onboarding: {
    readonly answers: OnboardingAnswers;
    readonly editHrefs: AnswerEditHrefs;
  } | null;
};

/**
 * Account settings: your username, what is public and optional, your theme,
 * your security and your account. Every form here writes durably.
 */
export function SettingsPage({
  username,
  analytics,
  dataRightsNotices,
  onboarding,
  ratingCard,
}: SettingsPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader title="Settings" />
      <div className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4">
        <nav
          aria-label="Settings sections"
          className="flex w-rail shrink-0 flex-col gap-1 max-compact:w-full"
        >
          {nav.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-md px-3 py-2 text-base text-ink-muted no-underline hover:bg-surface hover:text-ink hover:no-underline"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-6 max-compact:w-full max-compact:gap-4">
          <Section id="profile" title="Profile">
            <p className="text-base text-ink">
              {username ? (
                <>
                  <span className="text-ink-muted">Username </span>
                  <Link href={`/profile/${username}`}>{`@${username}`}</Link>
                </>
              ) : (
                <>
                  You have not chosen a username.{' '}
                  <Link href="/onboarding/username">Choose one</Link>
                </>
              )}
            </p>
            {onboarding === null ? null : (
              <div className="flex flex-col gap-2">
                <h3 className="text-md font-strong text-ink">
                  Your onboarding answers
                </h3>
                <AnswerSummary
                  answers={onboarding.answers}
                  editHrefs={onboarding.editHrefs}
                />
              </div>
            )}
          </Section>
          <Section id="privacy" title="Privacy and data">
            <p className="text-sm text-ink-muted">
              Not answering counts as no.
            </p>
            <ConsentControls {...analytics} />
            <p className="text-sm text-ink-muted">
              Read the <Link href="/privacy">privacy policy</Link> and the{' '}
              <Link href="/terms">terms of service</Link>.
            </p>
            <DataRights notices={dataRightsNotices} />
          </Section>
          {ratingCard ? (
            <Section id="ratings" title="Your card">
              {ratingCard}
            </Section>
          ) : null}
          <Section id="appearance" title="Appearance">
            <ThemeSwitcher />
          </Section>
          <Section id="security" title="Security">
            <Link
              href="/settings/security"
              className={cn(
                buttonClass('secondary'),
                'w-fit no-underline hover:no-underline',
              )}
            >
              Account security
            </Link>
          </Section>
        </div>
      </div>
    </div>
  );
}
