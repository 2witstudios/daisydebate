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
import { SIGN_OUT_FAILED_NOTICE } from '../../components/sign-out-form/sign-out-notice';
import { EmailChangeForm, type EmailChangeAction } from './email-change-form';
import { SecurityOverviewSections } from './security-overview-sections';
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

  return (
    <>
      <SecurityOverviewSections overview={overview} screen={screen} />
      <section aria-labelledby="email-heading">
        <h2 id="email-heading">Recovery email</h2>
        <EmailChangeForm action={changeEmail} />
      </section>
    </>
  );
}
