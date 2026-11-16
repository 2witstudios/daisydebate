import { AUTUMN, WINTER } from '../../../../../features/tab/sample/moment';
import { StoredDrawOverview } from './stored-draw';
import { notFound, redirect } from 'next/navigation';
import { hostRoutes } from '../../../../../features/tab/routes';
import {
  landingStop,
  readTimelineRail,
} from '../../../../../features/tab/tournament';
import { requireGrant } from '../../require-grant';

/** Opening a tournament lands on the stop of its timeline that most wants the host. */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug !== AUTUMN && slug !== WINTER)
    return <StoredDrawOverview handle={slug} />;
  const scene = await requireGrant(hostRoutes.tournament(slug));
  const rail = readTimelineRail(slug, scene);
  const stop = rail === null ? null : landingStop(rail);
  if (stop === null) notFound();
  redirect(stop);
}
