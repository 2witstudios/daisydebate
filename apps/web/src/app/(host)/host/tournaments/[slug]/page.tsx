import { requireTabRelease } from '../../../../../features/tab/release';
import { StoredDrawOverview } from './stored-draw';

/** Opening a tournament lands on the stop of its timeline that most wants the host. */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  await requireTabRelease();
  const { slug } = await params;
  return <StoredDrawOverview handle={slug} />;
}
