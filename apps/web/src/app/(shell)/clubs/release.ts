import { notFound } from 'next/navigation';
import type { Identity } from '@daisy/auth';
import { isReleaseEnabled } from '../../../features/flags/server';

/** Club pages answer as missing until `club-seats` is released to the viewer (ADR 0148). */
export async function requireClubRelease(identity: Identity): Promise<void> {
  const released = await isReleaseEnabled(
    'club-seats',
    identity.state === 'member' ? identity.principal.userId : null,
  ).catch(() => false);
  if (!released) notFound();
}
