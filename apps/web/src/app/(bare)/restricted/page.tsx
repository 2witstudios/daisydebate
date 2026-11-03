import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  requestIdentity,
  requestRestrictionEnd,
} from '../../../lib/request-session';
import type { SearchParams } from '../../../features/access/decision';
import { RestrictedAccount } from '../../../ui/moderation/restricted-account';

export const metadata: Metadata = {
  title: 'Account restricted',
  robots: { index: false, follow: false },
};

/** A suspended or banned account's page (ADR 0103); anyone else goes on. */
export default async function RestrictedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const identity = await requestIdentity();
  if (identity.state !== 'waitlisted' || identity.reason !== 'restricted')
    redirect('/');
  return (
    <RestrictedAccount
      username={identity.username}
      until={await requestRestrictionEnd(identity.principal.userId)}
      signOutFailed={(await searchParams).signOut === 'failed'}
    />
  );
}
