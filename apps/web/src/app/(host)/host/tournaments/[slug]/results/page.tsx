import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readEventResults } from '../../../../../../features/tab/results';
import { readSetup } from '../../../../../../features/tab/setup';
import { Results } from '../../../../../../ui/tab/results/results';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'Results' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const scene = await requireGrant(hostRoutes.results(slug));
  const rail = readTimelineRail(slug, scene);
  const results = readEventResults(slug, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || results === null || setup === null) notFound();
  return <Results rail={rail} event={setup.event} results={results} />;
}
