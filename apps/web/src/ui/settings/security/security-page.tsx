'use client';

import { useEffect, useState } from 'react';
import { authClient } from '../../../lib/auth-client';
import {
  createPasskeyEnrollment,
  enrollSafely,
} from '../../auth/onboarding/passkey-enrollment';
import {
  loadSecurityOverview,
  revokeOtherSessions,
  type PasskeyRow,
  type SessionRow,
} from '../../../features/account/security-client';
import { Button } from '../../components/button/button';
import { Notice } from '../../auth/notice/notice';
import { PasskeyRowView } from './passkey-row';
import { SessionRowView } from './session-row';
import { EmailChangeForm } from './email-change-form';
import { OUTCOME_NOTICES } from './security-notices';

const supportsPasskeys = () =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential === 'function';

const enrollment = createPasskeyEnrollment({
  client: authClient,
  supportsPasskeys,
});

/**
 * Passkeys, sessions and recovery email in one place (AUTH-5.3, 5.5, 5.6).
 * Removing a passkey or revoking a session still leaves magic-link access to
 * the verified email; this screen never removes that fallback.
 */
export function SecurityPage() {
  const [passkeys, setPasskeys] = useState<readonly PasskeyRow[]>([]);
  const [sessions, setSessions] = useState<readonly SessionRow[]>([]);
  const [currentToken, setCurrentToken] = useState<string | undefined>();
  const [loadNotice, setLoadNotice] = useState<string | undefined>();
  const [enrolling, setEnrolling] = useState(false);
  const [enrollNotice, setEnrollNotice] = useState<string | undefined>();
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((token) => token + 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [overview, session] = await Promise.all([
        loadSecurityOverview(authClient),
        authClient.getSession(),
      ]);
      if (cancelled) return;
      setPasskeys(overview.passkeys);
      setSessions(overview.sessions);
      setCurrentToken(session.data?.session.token);
      setLoadNotice(
        overview.sessionsOutcome.kind === 'ok'
          ? undefined
          : OUTCOME_NOTICES[overview.sessionsOutcome.kind],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <>
      <section aria-labelledby="passkeys-heading">
        <h2 id="passkeys-heading">Passkeys</h2>
        {loadNotice ? (
          <Notice id="security-load-notice" tone="error" title={loadNotice} />
        ) : null}
        <ul>
          {passkeys.map((passkey) => (
            <PasskeyRowView
              key={passkey.id}
              passkey={passkey}
              onRenamed={(id, name) =>
                setPasskeys((rows) =>
                  rows.map((row) => (row.id === id ? { ...row, name } : row)),
                )
              }
              onRemoved={(id) =>
                setPasskeys((rows) => rows.filter((row) => row.id !== id))
              }
            />
          ))}
        </ul>
        <Button
          disabled={enrolling}
          onClick={() => {
            setEnrolling(true);
            setEnrollNotice(undefined);
            void enrollSafely(enrollment).then((outcome) => {
              setEnrolling(false);
              if (outcome.kind === 'saved') reload();
              else
                setEnrollNotice(
                  outcome.kind === 'unavailable'
                    ? 'Saving a passkey is not available on this device.'
                    : outcome.kind === 'cancelled'
                      ? 'Nothing was saved.'
                      : 'We could not save a passkey. Please try again.',
                );
            });
          }}
        >
          {enrolling ? 'Waiting for your device…' : 'Add a passkey'}
        </Button>
        {enrollNotice ? (
          <Notice id="enroll-notice" tone="error" title={enrollNotice} />
        ) : null}
      </section>

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading">Sessions</h2>
        <ul>
          {sessions.map((session) => (
            <SessionRowView
              key={session.id}
              session={session}
              current={session.token === currentToken}
              onRevoked={(id) =>
                setSessions((rows) => rows.filter((row) => row.id !== id))
              }
            />
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              void revokeOtherSessions(authClient).then((outcome) => {
                if (outcome.kind === 'ok') reload();
                else setLoadNotice(OUTCOME_NOTICES[outcome.kind]);
              })
            }
          >
            Sign out of all other sessions
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void authClient
                .signOut()
                .then(() => window.location.assign('/sign-in'))
            }
          >
            Sign out
          </Button>
        </div>
      </section>

      <section aria-labelledby="email-heading">
        <h2 id="email-heading">Recovery email</h2>
        <EmailChangeForm />
      </section>
    </>
  );
}
