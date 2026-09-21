import type { Metadata } from 'next';
import { systemClock } from '@daisy/clock';
import { ConfirmSignIn } from '../../ui/auth/confirm-sign-in/confirm-sign-in';
import { LinkExpired } from '../../ui/auth/link-expired/link-expired';
import {
  MOCK_EMAIL,
  mockFlowState,
  parseMockPreview,
} from '../../ui/auth/mock/mock-sign-in-port';
import { MockSavePasskey, MockSignIn } from '../../ui/auth/mock/mock-sign-in';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

/**
 * Sign-in, running on the mock port until AUTH-4.1 wires Better Auth.
 * `?preview=` opens any step directly for review; the confirm and expired
 * steps belong to the emailed-link route and are shown here for design only.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const preview = parseMockPreview((await searchParams).preview);
  switch (preview) {
    case 'confirm':
      return (
        <ConfirmSignIn
          target={{
            action: '/sign-in',
            method: 'get',
            fields: { preview: 'save-passkey' },
          }}
        />
      );
    case 'expired':
      return (
        <LinkExpired
          target={{
            action: '/sign-in',
            method: 'get',
            fields: { preview: 'check-inbox' },
          }}
        />
      );
    case 'save-passkey':
      return <MockSavePasskey email={MOCK_EMAIL} />;
    default:
      return (
        <MockSignIn initialState={mockFlowState(preview, systemClock.now())} />
      );
  }
}
