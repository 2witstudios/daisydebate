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
import { Badge } from '../../components/badge/badge';
import { SectionJump } from './section-jump';

const panel =
  'flex scroll-mt-20 flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'font-display text-xl font-bold text-ink';

const nav = [
  ['profile', 'Profile'],
  ['media-release', 'Media release'],
  ['notifications', 'Notifications'],
  ['watch-history', 'Watch history'],
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
  /**
   * The member's display name, bio and photo (ADR 0143), when their public
   * profile could be read.
   */
  readonly publicProfile?: ReactNode;
  /** The member's own status choice, the rail's control again (ADR 0103). */
  readonly status?: ReactNode;
  /** What is stored for the member, when it could be read (ISSUE-1045). */
  readonly notifications?: ReactNode;
  /** What the member has watched, which they alone see and can clear. */
  readonly watchHistory?: ReactNode;
  /** A youth member's media release (ADR 0151), while releases are open. */
  readonly mediaRelease?: ReactNode;
  readonly familySettings?: 'adult' | 'child' | null;
  readonly username: string | null;
  readonly analytics: {
    readonly choice: ConsentChoice;
    readonly available: AnalyticsAvailability;
  };
  /** The member's data-rights notices, parsed from the handlers' fixed keys. */
  readonly dataRightsNotices: DataRightsNotices;
  /**
   * The member's optional onboarding answers and where each is changed
   * (ISSUE-324); null when they are not asked of this member (under 13, or
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
  publicProfile,
  status,
  notifications,
  watchHistory,
  mediaRelease,
  familySettings,
}: SettingsPageProps) {
  const sections = nav.filter(([id]) => id !== 'media-release' || mediaRelease);
  const familyLink =
    familySettings === 'adult'
      ? (['/settings/parental-controls', 'Parental controls'] as const)
      : familySettings === 'child'
        ? (['/settings/your-parents', 'Your parents'] as const)
        : null;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader title="Settings" />
      <div className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4">
        <SectionJump
          sections={[
            ['/settings/billing', 'Billing'],
            ...(familyLink ? [familyLink] : []),
            ...sections.map(([id, label]) => [`#${id}`, label] as const),
          ]}
        />
        <nav
          aria-label="Settings sections"
          className="flex w-rail shrink-0 flex-col gap-1 max-compact:hidden"
        >
          <Link
            href="/settings/billing"
            className="rounded-md px-3 py-2 text-base text-ink-muted no-underline hover:bg-surface hover:text-ink hover:no-underline"
          >
            Billing
          </Link>
          {familyLink ? (
            <Link
              href={familyLink[0]}
              className="rounded-md px-3 py-2 text-base text-ink-muted no-underline hover:bg-surface hover:text-ink hover:no-underline"
            >
              {familyLink[1]}
            </Link>
          ) : null}
          {sections.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-base text-ink-muted no-underline hover:bg-surface hover:text-ink hover:no-underline"
            >
              {label}
              {id === 'media-release' ? <Badge tone="plum">New</Badge> : null}
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
            {publicProfile}
            {status ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-md font-strong text-ink">Status</h3>
                {status}
              </div>
            ) : null}
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
          {mediaRelease ? (
            <Section id="media-release" title="Media release">
              {mediaRelease}
            </Section>
          ) : null}
          <Section id="privacy" title="Privacy and data">
            {analytics.available.analytics || analytics.available.replay ? (
              <p className="text-sm text-ink-muted">
                Not answering counts as no.
              </p>
            ) : null}
            <ConsentControls {...analytics} />
            <p className="text-sm text-ink-muted">
              Read the <Link href="/privacy">privacy policy</Link> and the{' '}
              <Link href="/terms">terms of service</Link>.
            </p>
            <DataRights notices={dataRightsNotices} />
          </Section>
          {notifications ? (
            <Section id="notifications" title="Notifications">
              {notifications}
            </Section>
          ) : null}
          {watchHistory ? (
            <Section id="watch-history" title="Watch history">
              {watchHistory}
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
