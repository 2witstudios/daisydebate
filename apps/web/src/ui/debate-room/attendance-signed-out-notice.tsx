import { StatusRegion } from '../components/status-region/status-region';
import { signInHref } from '../../features/access/decision';

/**
 * Check-in stopped because the session is gone (a 401): nothing retries, so
 * the debater must sign in again to be credited for their speeches.
 */
export function AttendanceSignedOutNotice({
  roundId,
}: {
  readonly roundId: string;
}) {
  return (
    <StatusRegion as="p" role="alert" className="px-4 py-1 text-sm text-ink">
      You were signed out, so your check-ins stopped.{' '}
      <a href={signInHref(`/rounds/${roundId}`)} className="font-semibold">
        Sign in again
      </a>
    </StatusRegion>
  );
}
