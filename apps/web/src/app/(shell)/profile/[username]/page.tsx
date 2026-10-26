import { parseUsername } from '@daisy/auth';
import { isAppError } from '@daisy/errors';
import { matchHistoryQuerySchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { ProfilePage } from '../../../../ui/profile/profile-page/profile-page';
import { requestMemberProfile } from '../../../../lib/request-session';

export const metadata: Metadata = { title: 'Profile' };

/** Public: anyone may read a member's profile; only its owner sees every Round. */
export default async function ProfileRoute({
  params,
  searchParams,
}: {
  readonly params: Promise<{ username: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { username } = await params;
  const name = parseUsername(username);
  if (!name.ok) notFound();
  const raw = await searchParams;
  const query = matchHistoryQuerySchema.safeParse(
    typeof raw.before === 'string' ? { before: raw.before } : {},
  );
  if (!query.success) notFound();
  const profile = await requestMemberProfile(name.username, query.data).catch(
    (error: unknown) => {
      // A stale or foreign cursor is a page that does not exist.
      if (isAppError(error) && error.code === 'VALIDATION') return notFound();
      throw error;
    },
  );
  if (profile === null) notFound();
  return (
    <ProfilePage profile={profile} paged={query.data.before !== undefined} />
  );
}
