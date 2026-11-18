import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireGrant } from '../../../../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { readEventResults } from '../../../../../../../../features/tab/sample/read-results';
import { readSetup } from '../../../../../../../../features/tab/sample/read-setup';
import { readTimelineRail } from '../../../../../../../../features/tab/sample/read-tournament';
import { Results } from '../../../../../../../../ui/tab/results/results';

export const metadata: Metadata = { title: 'Results' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug } = await params;

  const scene = await requireGrant(hostRoutes.results(slug));
  const rail = readTimelineRail(slug, scene);
  const results = readEventResults(slug, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || results === null || setup === null) notFound();
  return <Results rail={rail} event={setup.event} results={results} />;
}
