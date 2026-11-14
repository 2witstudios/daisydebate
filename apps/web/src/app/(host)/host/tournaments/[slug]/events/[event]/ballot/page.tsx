import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readBallotSettings } from '../../../../../../../../features/tab/ballot-definition';
import { BallotSettings } from '../../../../../../../../ui/tab/ballot-settings/ballot-settings';
import { sampleSubmit } from '../../../../../../../(tab)/sample-submit';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../../../features/tab/tournament';
import { requireGrant } from '../../../../../require-grant';

export const metadata: Metadata = { title: 'Ballot' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string; event: string }>;
}) {
  const { slug, event } = await params;
  const scene = await requireGrant(hostRoutes.ballot(slug, event));
  const rail = readTimelineRail(slug, scene);
  const settings = readBallotSettings(slug, event, scene);
  if (rail === null || settings === null) notFound();
  return (
    <BallotSettings
      rail={rail}
      settings={settings}
      submit={sampleSubmit(hostRoutes.ballot(slug, event))}
    />
  );
}
