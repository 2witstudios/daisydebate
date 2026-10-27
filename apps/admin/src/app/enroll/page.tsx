import { PasskeyCeremony } from '../passkey-ceremony';

export const dynamic = 'force-dynamic';

/** Rendering consumes nothing: the token stays in the fragment until used. */
export default function EnrollPage() {
  return (
    <>
      <h1>Create your admin passkey</h1>
      <p className="muted">
        This link works once and expires 15 minutes after it was issued.
      </p>
      <PasskeyCeremony kind="enroll" />
      <noscript>
        <p>
          Creating a passkey needs JavaScript; it is the only script this app
          runs.
        </p>
      </noscript>
    </>
  );
}
