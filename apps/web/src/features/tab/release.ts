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

/** The host home and event upgrades: Tab and host tiers both released (ADR 0147). */
export async function hostTiersReleased(): Promise<boolean> {
  const identity = await requestIdentity();
  const userId = identity.state === 'member' ? identity.principal.userId : null;
  return (
    (await isReleaseEnabled('daisy-tab', userId)) &&
    isReleaseEnabled('host-tiers', userId)
  );
}

export async function requireHostTiersRelease(): Promise<void> {
  if (!(await hostTiersReleased())) notFound();
}
