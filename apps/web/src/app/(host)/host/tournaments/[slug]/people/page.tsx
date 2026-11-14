import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { readPeople } from '../../../../../../features/tab/organization';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { People } from '../../../../../../ui/tab/people/people';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'People' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ role?: string | string[] }>;
}) {
  const { slug } = await params;
  const { role } = await searchParams;
  const path = hostRoutes.people(slug);
  const scene = await requireGrant(path);
  const rail = readTimelineRail(slug, scene);
  if (rail === null) notFound();
  return (
    <People
      rail={rail}
      people={readPeople(typeof role === 'string' ? role : null, path, scene)}
    />
  );
}
