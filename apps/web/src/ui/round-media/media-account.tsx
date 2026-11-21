'use client';

import { useBrowserEffect } from '../edge/browser-sync';

import { clearAccountResumeRecords } from '../../features/rooms/resume-departure';
import { selectMediaAccount } from '../../features/round-media/account-signout-cleanup';

export function MediaAccount({ actorId }: { readonly actorId: string | null }) {
  useBrowserEffect(() => {
    if (selectMediaAccount(actorId)) clearAccountResumeRecords();
  }, [actorId]);
  return null;
}
