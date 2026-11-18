import { walkHref } from '../../../../../../../features/tab/walk-href';
import { notFound, redirect } from 'next/navigation';
import { requireGrant } from '../../../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../../features/tab/sample/read-tournament';
import { landingStop } from '../../../../../../../features/tab/tournament';

/** Opening a tournament lands on the stop of its timeline that most wants the host. */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const scene = await requireGrant(hostRoutes.tournament(slug));
  const rail = readTimelineRail(slug, scene);
  const stop = rail === null ? null : landingStop(rail);
  if (stop === null) notFound();
  redirect(walkHref(stop));
}
