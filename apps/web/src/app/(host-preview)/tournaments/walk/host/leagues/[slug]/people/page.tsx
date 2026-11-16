import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readLeagueRail } from '../../../../../../../../features/tab/league';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { readPeople } from '../../../../../../../../features/tab/sample/read-organization';
import { People } from '../../../../../../../../ui/tab/people/people';
import { requireGrant } from '../../../../../../../(tab)/tournaments/walk/require-grant';

export const metadata: Metadata = { title: 'People' };

/**
 * The walk's sample people screen has no stored-data or command path.
 */
export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ role?: string | string[] }>;
}) {
  const { slug } = await params;
  const { role } = await searchParams;
  const chosen = typeof role === 'string' ? role : null;
  const path = hostRoutes.leaguePeople(slug);

  const scene = await requireGrant(path);
  const rail = readLeagueRail(slug, scene);
  if (rail === null) notFound();
  return <People rail={rail} people={readPeople(chosen, path, scene)} />;
}
