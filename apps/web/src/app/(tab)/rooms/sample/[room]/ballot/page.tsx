import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { requireAccess } from '../../../../../../lib/access';
import { requireTabRelease } from '../../../../../../features/tab/release';
import { tabRoutes } from '../../../../../../features/tab/routes';

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ room: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { room } = await params;
  await requireAccess(tabRoutes.ballot(room), searchParams);
  await requireTabRelease();
  notFound();
}
