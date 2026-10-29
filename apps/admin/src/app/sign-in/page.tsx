import { redirect } from 'next/navigation';
import { currentOperator } from '../../server/operator-gate';
import { DaisyMark } from '../operator-nav';
import { PasskeyCeremony } from '../passkey-ceremony';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly enrolled?: string }>;
}) {
  if (await currentOperator()) redirect('/accounts');
  const { enrolled } = await searchParams;
  return (
    <div className="auth">
      <DaisyMark size={34} />
      <h1>Sign in to Daisy admin</h1>
      {enrolled === '1' ? (
        <p className="notice notice-ok">
          Passkey created. Sign in with it now.
        </p>
      ) : null}
      <PasskeyCeremony kind="sign-in" />
      <noscript>
        <p>
          Passkey sign-in needs JavaScript; it is the only script this app runs.
        </p>
      </noscript>
    </div>
  );
}
