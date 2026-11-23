import { Announcement } from '../components/announcement/announcement';
import Link from 'next/link';
import type { ClubInvitationView } from '../../features/clubs/views';
import type { FormAction } from '../form-action/form-action';
import { buttonClass } from '../components/button/button-class';
import { PageHeader } from '../components/page-header/page-header';
import { ReadingPage } from '../components/reading-page/reading-page';
import { day } from './club-copy';
import type { ClubFormState } from './club-form-state';
import { InvitationAnswerForm } from './invitation-answer-form';

/**
 * Accept a club seat (RClubInviteAccept, step 1). The media-release step
 * for under-18s belongs to a later slice and is not shown.
 */
export function ClubInvitationPage({
  view,
  username,
  action,
}: {
  readonly view: ClubInvitationView;
  readonly username: string | null;
  readonly action: FormAction<ClubFormState>;
}) {
  return (
    <ReadingPage>
      <PageHeader
        title="Club invitation"
        lede={username ? `For @${username}` : undefined}
      />
      <section className="flex flex-col gap-5 rounded-xl bg-surface p-6 shadow-1">
        <div className="flex flex-col gap-1">
          <span className="text-ink-muted">{view.manager} invited you to</span>
          <strong className="font-display text-2xl">{view.club.name}</strong>
        </div>
        <InvitationBody view={view} action={action} />
      </section>
    </ReadingPage>
  );
}

function InvitationBody({
  view,
  action,
}: {
  readonly view: ClubInvitationView;
  readonly action: FormAction<ClubFormState>;
}) {
  switch (view.kind) {
    case 'open':
      return (
        <>
          <ul className="flex flex-col gap-4">
            <li className="flex flex-col">
              <strong>A Premium seat, paid by the club</strong>
              <span className="text-ink-muted">
                AI judging, analysis and recording. Nothing to pay.
              </span>
            </li>
            <li className="flex flex-col">
              <strong>You can leave any time</strong>
              <span className="text-ink-muted">
                You keep your account, ratings and Rounds. Premium ends when the
                seat does.
              </span>
            </li>
          </ul>
          <p className="text-sm text-ink-muted">
            For {view.email}. Open until {day(view.expiresAt)}.
          </p>
          <InvitationAnswerForm action={action} />
          {view.ownPremium ? (
            <p className="text-sm text-ink-muted">
              You already pay for Premium. Your own subscription stays until you
              cancel it.{' '}
              <Link href="/settings/billing" className="font-strong underline">
                Manage your subscription
              </Link>
            </p>
          ) : null}
        </>
      );
    case 'expired':
      return (
        <Announcement as="p" kind="progress">
          This invitation has expired. Ask {view.manager} to send a new one.
        </Announcement>
      );
    case 'seated-here':
      return (
        <>
          <Announcement as="p" kind="progress">
            You already hold a seat in {view.club.name}.
          </Announcement>
          <Link
            href="/settings/billing"
            className={`${buttonClass('secondary')} self-start`}
          >
            See your billing
          </Link>
        </>
      );
    case 'seated-elsewhere':
      return (
        <Announcement as="p" kind="progress">
          You already hold a seat in another club. One person can hold one seat,
          so leave that seat before accepting this one.
        </Announcement>
      );
  }
}
