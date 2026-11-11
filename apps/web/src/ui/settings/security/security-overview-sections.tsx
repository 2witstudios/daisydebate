'use client';

import { Button } from '../../components/button/button';
import { buttonClass } from '../../components/button/button-class';
import { SignOutForm } from '../../components/sign-out-form/sign-out-form';
import { Notice } from '../../auth/notice/notice';
import { PasskeyRowView } from './passkey-row';
import { SessionRowView } from './session-row';
import {
  signOutNoticeOf,
  type SecurityList,
  type SecurityLists,
  type SecurityOverview,
} from './security-overview-model';

type Row = { readonly id: string };

/** Why a list has no rows to show, when its read said so. */
function UnreadNotice({
  id,
  list,
}: {
  readonly id: string;
  readonly list: SecurityList<Row> | undefined;
}) {
  return list?.kind === 'unavailable' ? (
    <Notice id={id} tone="error" title={list.notice} />
  ) : null;
}

function PasskeyList({
  lists,
  onRenamed,
  onRemoved,
}: {
  readonly lists: SecurityLists;
  readonly onRenamed: (id: string, name: string) => void;
  readonly onRemoved: (id: string) => void;
}) {
  if (lists.kind !== 'read') return <p role="status">Loading passkeys…</p>;
  if (lists.passkeys.kind === 'unavailable')
    return <UnreadNotice id="passkeys-load-notice" list={lists.passkeys} />;
  return (
    <ul>
      {lists.passkeys.rows.map((passkey) => (
        <PasskeyRowView
          key={passkey.id}
          passkey={passkey}
          onRenamed={onRenamed}
          onRemoved={onRemoved}
        />
      ))}
    </ul>
  );
}

function SessionList({
  lists,
  onRevoked,
}: {
  readonly lists: SecurityLists;
  readonly onRevoked: (id: string) => void;
}) {
  if (lists.kind !== 'read') return <p role="status">Loading sessions…</p>;
  if (lists.sessions.kind === 'unavailable') return null;
  return (
    <ul>
      {lists.sessions.rows.map((session) => (
        <SessionRowView
          key={session.id}
          session={session}
          onRevoked={onRevoked}
        />
      ))}
    </ul>
  );
}

/** What the member can do from the passkeys and sessions sections. */
export type SecurityOverviewActions = {
  readonly renamePasskey: (id: string, name: string) => void;
  readonly removePasskey: (id: string) => void;
  readonly removeSession: (id: string) => void;
  readonly signOutOthers: () => void;
  readonly addPasskey: () => void;
};

/**
 * The passkeys and sessions sections, drawn from the one value the screen
 * holds: lists not yet read say they are loading, and a list its read could
 * not bring says so in place of its rows.
 */
export function SecurityOverviewSections({
  overview,
  screen,
}: {
  readonly overview: SecurityOverview;
  readonly screen: SecurityOverviewActions;
}) {
  const { lists, enrolment } = overview;
  const signOutNotice = signOutNoticeOf(overview);
  const enrolling = enrolment.kind === 'waiting';
  const signingOutOthers = overview.signOut.kind === 'asking';

  return (
    <>
      <section aria-labelledby="passkeys-heading">
        <h2 id="passkeys-heading">Passkeys</h2>
        <PasskeyList
          lists={lists}
          onRenamed={screen.renamePasskey}
          onRemoved={screen.removePasskey}
        />
        <Button disabled={enrolling} onClick={screen.addPasskey}>
          {enrolling ? 'Waiting for your device…' : 'Add a passkey'}
        </Button>
        {enrolment.kind === 'failed' ? (
          <Notice id="enroll-notice" tone="error" title={enrolment.notice} />
        ) : null}
      </section>

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading">Sessions</h2>
        <UnreadNotice
          id="sessions-load-notice"
          list={lists.kind === 'read' ? lists.sessions : undefined}
        />
        {signOutNotice === null ? null : (
          <Notice id="sign-out-notice" tone="error" title={signOutNotice} />
        )}
        <SessionList lists={lists} onRevoked={screen.removeSession} />
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={signingOutOthers}
            onClick={screen.signOutOthers}
          >
            {signingOutOthers
              ? 'Signing out…'
              : 'Sign out of all other sessions'}
          </Button>
          <SignOutForm
            next="/settings/security"
            className={buttonClass('ghost')}
          />
        </div>
      </section>
    </>
  );
}
