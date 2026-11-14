import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readSetup } from '../../../../../../features/tab/setup';
import { Setup } from '../../../../../../ui/tab/setup/setup';
import { sampleSubmit } from '../../../../../(tab)/sample-submit';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'Setup' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ panel?: string | string[] }>;
}) {
  const { slug } = await params;
  const { panel } = await searchParams;
  const scene = await requireGrant(hostRoutes.setup(slug));
  const rail = readTimelineRail(slug, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || setup === null) notFound();
  return (
    <Setup
      rail={rail}
      setup={setup}
      panel={panel === 'pairing' ? 'pairing' : null}
      submit={sampleSubmit(hostRoutes.setup(slug))}
    />
  );
}
