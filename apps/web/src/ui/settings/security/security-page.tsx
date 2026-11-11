'use client';

import { authClient } from '../../../lib/auth-client';
import {
  createPasskeyEnrollment,
  enrollSafely,
} from '../../auth/onboarding/passkey-enrollment';
import {
  loadSecurityOverview,
  revokeOtherSessions,
} from '../../../features/account/security-client';
import { Button } from '../../components/button/button';
import { buttonClass } from '../../components/button/button-class';
import { SignOutForm } from '../../components/sign-out-form/sign-out-form';
import { SIGN_OUT_FAILED_NOTICE } from '../../components/sign-out-form/sign-out-notice';
import { Notice } from '../../auth/notice/notice';
import { PasskeyRowView } from './passkey-row';
import { SessionRowView } from './session-row';
import { EmailChangeForm, type EmailChangeAction } from './email-change-form';
import {
  signOutNoticeOf,
  type SecurityList,
  type SecurityLists,
} from './security-overview-model';
import { useSecurityOverview } from './use-security-overview';

const supportsPasskeys = () =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function';

const enrollment = createPasskeyEnrollment({
  client: authClient,
  supportsPasskeys,
});

const loadOverview = () => loadSecurityOverview(authClient);
const revokeOthers = () => revokeOtherSessions(authClient);
const enrol = () => enrollSafely(enrollment);

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
  if (lists.kind === 'loading') return <p role="status">Loading passkeys…</p>;
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
  if (lists.kind === 'loading') return <p role="status">Loading sessions…</p>;
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

/**
 * Passkeys, sessions and recovery email in one place (AUTH-5.3, 5.5, 5.6).
 * Removing a passkey or revoking a session still leaves magic-link access to
 * the verified email; this screen never removes that fallback.
 */
export function SecurityPage({
  changeEmail,
  signOutFailed = false,
}: {
  /** The email-change form's server action. */
  readonly changeEmail: EmailChangeAction;
  /** Back from a sign-out that did not happen. */
  readonly signOutFailed?: boolean;
}) {
  const { overview, ...screen } = useSecurityOverview({
    load: loadOverview,
    revokeOthers,
    enrol,
    signOutNotice: signOutFailed ? SIGN_OUT_FAILED_NOTICE : undefined,
  });
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

      <section aria-labelledby="email-heading">
        <h2 id="email-heading">Recovery email</h2>
        <EmailChangeForm action={changeEmail} />
      </section>
    </>
  );
}
