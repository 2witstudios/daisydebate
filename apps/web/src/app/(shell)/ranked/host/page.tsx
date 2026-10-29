import { redirect } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
export default async function HostRankedRoomPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/ranked/host', searchParams);
  redirect('/play/room?rated=1');
}
