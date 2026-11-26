import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeaguesPage } from '../../../ui/marketing/leagues-page';
import { requestAudienceLinks } from '../audience-links';

const description =
  'Run your debate league’s season on Daisy: your own lobbies, ladder, seasons and tournaments.';

export const metadata: Metadata = {
  title: 'Daisy for leagues',
  description,
  alternates: { canonical: '/leagues' },
};

/**
 * Public: Daisy for a league director, while league requests are open. Only
 * this root is public; a league's own pages under it stay guarded.
 */
export default async function Leagues() {
  const links = await requestAudienceLinks();
  if (links.league === null) notFound();
  return <LeaguesPage links={links} />;
}
