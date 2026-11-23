'use client';

import { useDeliver } from '../edge/use-answer';

import { clearAccountResumeRecords } from '../../features/rooms/resume-departure';
import { selectMediaAccount } from '../../features/round-media/account-signout-cleanup';

export function MediaAccount({ actorId }: { readonly actorId: string | null }) {
  useDeliver(actorId, (account) => {
    if (selectMediaAccount(account)) clearAccountResumeRecords();
  });
  return null;
}
