import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { People } from '../../../../../../ui/tab/people/people';
import { peopleControls } from './controls';
import { readStoredPeople } from './stored-people';

export const metadata: Metadata = { title: 'People' };

/**
 * A league's people, read from stored state; a viewer who may not read its
 * people finds no page. The sample walk's league lives beneath the walk.
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
  await requireTabRelease();
  const stored = await readStoredPeople(slug, chosen, path);
  if (stored === null) notFound();
  return (
    <People
      rail={stored.rail}
      people={stored.people}
      controls={peopleControls(stored.view, slug)}
    />
  );
}
