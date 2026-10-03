import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { playOptions } from '../../../features/play/options';
import { requireAccess } from '../../../lib/access';
import { PlayGateway } from '../../../ui/play/play-gateway/play-gateway';

export const metadata: Metadata = { title: 'Play' };

/** Play: the ways to debate, each its own page. */
export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/play', searchParams);
  return <PlayGateway options={playOptions} />;
}
