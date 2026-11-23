import { idSchema } from '@daisy/protocol/primitives';
import { createAppError } from '@daisy/errors';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { requireTabRelease } from '../../../../features/tab/release';
import { requireAccess } from '../../../../features/access/page-access';
import { roomAssembly } from '../../../(shell)/rooms/[id]/actions';

export async function storedEventRoom(
  roomId: string,
  address: string,
  searchParams: Promise<SearchParams>,
) {
  const identity = await requireAccess(address, searchParams);
  await requireTabRelease();
  if (identity.state !== 'member' || !idSchema.safeParse(roomId).success)
    notFound();
  const result = await roomAssembly(roomId, 'event');
  if (result.kind === 'missing') notFound();
  if (result.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return result.view;
}
