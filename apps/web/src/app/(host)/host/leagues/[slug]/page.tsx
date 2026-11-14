import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  readHostLeague,
  readLeagueRail,
} from '../../../../../features/tab/league';
import { hostRoutes } from '../../../../../features/tab/routes';
import { HostLeague } from '../../../../../ui/tab/host-league/host-league';
import { requireGrant } from '../../require-grant';

export const metadata: Metadata = { title: 'League' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const scene = await requireGrant(hostRoutes.league(slug));
  const rail = readLeagueRail(slug, scene);
  const league = readHostLeague(slug, scene);
  if (rail === null || league === null) notFound();
  return <HostLeague rail={rail} league={league} />;
}
