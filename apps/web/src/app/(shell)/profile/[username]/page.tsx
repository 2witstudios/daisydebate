import { parseUsername } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import { matchHistoryQuerySchema } from '@daisy/protocol';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { ProfilePage } from '../../../../ui/profile/profile-page/profile-page';
import { readMemberProfile } from './actions';

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
  const result = await readMemberProfile(name.username, query.data);
  if (result.kind === 'missing' || result.kind === 'invalid') notFound();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <ProfilePage
      profile={result.profile}
      paged={query.data.before !== undefined}
    />
  );
}
