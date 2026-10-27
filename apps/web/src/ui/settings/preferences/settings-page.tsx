import type { OnboardingAnswers } from '../../../features/onboarding/answers';
import {
  AnswerSummary,
  type AnswerEditHrefs,
} from '../../onboarding/answer-summary/answer-summary';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  Preferences,
  Section,
} from '../../../features/settings/preferences';
import { buttonClass } from '../../components/button/button-class';
import { Notice } from '../../components/notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import { ThemeSwitcher } from '../../components/theme-switcher/theme-switcher';
import type { MockFormAction } from '../../form-action/mock-form';
import { cn } from '../../cn';
import {
  NotificationsForm,
  PrivacyForm,
  ProfileForm,
} from './preferences-forms';

const panel =
  'flex scroll-mt-20 flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const heading = 'font-display text-xl font-bold text-ink';

const savedText: Readonly<Record<Section, string>> = {
  profile: 'Profile saved.',
  notifications: 'Notification settings saved.',
  privacy: 'Privacy settings saved.',
};

const nav = [
  ['profile', 'Profile'],
  ['notifications', 'Notifications'],
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
  readonly username: string | null;
  readonly preferences: Preferences;
  readonly saved: Section | null;
  readonly profileAction: MockFormAction;
  readonly notificationsAction: MockFormAction;
  readonly privacyAction: MockFormAction;
  /**
   * The member's optional onboarding answers and where each is changed
   * (ISSUE-324); null when they are not asked of this member (under 16, or
   * no age on record), so nothing optional is shown.
   */
  readonly onboarding?: {
    readonly answers: OnboardingAnswers;
    readonly editHrefs: AnswerEditHrefs;
  } | null;
};

/**
 * Account settings: your public profile, the email you get, what is public
 * and optional, your theme, your security and your account. Each form is a
 * real POST; nothing is kept until an account stores preferences.
 */
export function SettingsPage({
  username,
  preferences,
  saved,
  profileAction,
  notificationsAction,
  privacyAction,
  onboarding = null,
}: SettingsPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader title="Settings" />
      {saved ? (
        <Notice
          tone="accent"
          icon="check"
          title={savedText[saved]}
          role="status"
        />
      ) : null}
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
            <ProfileForm action={profileAction} prefs={preferences.profile} />
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
          <Section id="notifications" title="Notifications">
            <NotificationsForm
              action={notificationsAction}
              prefs={preferences.notifications}
            />
          </Section>
          <Section id="privacy" title="Privacy and data">
            <p className="text-sm text-ink-muted">
              Not answering counts as no.
            </p>
            <PrivacyForm action={privacyAction} prefs={preferences.privacy} />
            <p className="text-sm text-ink-muted">
              Read the <Link href="/privacy">privacy policy</Link> and the{' '}
              <Link href="/terms">terms of service</Link>.
            </p>
          </Section>
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
