import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  Preferences,
  Section,
} from '../../../features/settings/preferences';
import { buttonClass } from '../../components/button/button-class';
import { Notice } from '../../components/notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import { SampleAction } from '../../components/sample-action/sample-action';
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
  ['account', 'Your account'],
] as const;

function Section({
  id,
  title,
  lede,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly lede: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={panel}>
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className={heading}>
          {title}
        </h2>
        <p className="text-base text-ink-muted">{lede}</p>
      </div>
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
}: SettingsPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader
        title="Settings"
        lede="Your profile, notifications, privacy and security."
      />
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
          <Section
            id="profile"
            title="Profile"
            lede="What other debaters see on your public profile."
          >
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
          </Section>
          <Section
            id="notifications"
            title="Notifications"
            lede="Choose the email Daisy sends you."
          >
            <NotificationsForm
              action={notificationsAction}
              prefs={preferences.notifications}
            />
          </Section>
          <Section
            id="privacy"
            title="Privacy and data"
            lede="What is public, and the optional data you allow. Not answering counts as no."
          >
            <PrivacyForm action={privacyAction} prefs={preferences.privacy} />
            <p className="text-sm text-ink-muted">
              Read the <Link href="/privacy">privacy policy</Link> and the{' '}
              <Link href="/terms">terms of service</Link>.
            </p>
          </Section>
          <Section
            id="appearance"
            title="Appearance"
            lede="Choose a theme, or follow your device setting."
          >
            <ThemeSwitcher />
          </Section>
          <Section
            id="security"
            title="Security"
            lede="Manage your passkeys, sessions and recovery email."
          >
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
          <Section
            id="account"
            title="Your account"
            lede="Take your data with you, or remove it."
          >
            <div className="flex flex-wrap gap-3">
              <SampleAction
                label="Export my data"
                className={buttonClass('secondary')}
              >
                Export my data
              </SampleAction>
              <SampleAction
                label="Delete my account"
                className={cn(
                  buttonClass('ghost'),
                  'border-live text-live hover:text-live',
                )}
              >
                Delete my account
              </SampleAction>
            </div>
            <p className="text-sm text-ink-faint">
              Deleting removes what identifies you. Results you took part in
              stay as an anonymous entry so other people’s standings do not
              change.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
