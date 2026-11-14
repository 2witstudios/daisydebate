import { notFound } from 'next/navigation';
import { requestIdentity } from '../../lib/request-session';
import { isReleaseEnabled } from '../flags/server';

/** Whether Daisy Tab's screens are released to this request's viewer. */
export async function tabReleased(): Promise<boolean> {
  const identity = await requestIdentity();
  return isReleaseEnabled(
    'daisy-tab',
    identity.state === 'member' ? identity.principal.userId : null,
  );
}

/** Every Tab route answers as a missing page until the release is open. */
export async function requireTabRelease(): Promise<void> {
  if (!(await tabReleased())) notFound();
}
