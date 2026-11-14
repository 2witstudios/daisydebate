import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  isSampleLeague,
  readLeagueRail,
} from '../../../../../../features/tab/league';
import { readPeople } from '../../../../../../features/tab/organization';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { People } from '../../../../../../ui/tab/people/people';
import { requireGrant } from '../../../require-grant';
import { readStoredPeople } from './stored-people';

export const metadata: Metadata = { title: 'People' };

/**
 * A league's people. The sample walk's league reads the sample scene; any
 * other address is a stored organization, read from stored state, and a
 * viewer who may not read its people finds no page.
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
  if (isSampleLeague(slug)) {
    const scene = await requireGrant(path);
    const rail = readLeagueRail(slug, scene);
    if (rail === null) notFound();
    return <People rail={rail} people={readPeople(chosen, path, scene)} />;
  }
  await requireTabRelease();
  const stored = await readStoredPeople(slug, chosen, path);
  if (stored === null) notFound();
  return <People rail={stored.rail} people={stored.people} />;
}
