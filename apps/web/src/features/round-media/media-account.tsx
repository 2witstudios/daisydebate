'use client';

import { useBrowserEffect } from '../../ui/edge/browser-sync';

import { clearAccountResumeRecords } from '../rooms/resume-departure';
import { selectMediaAccount } from './account-signout-cleanup';

export function MediaAccount({ actorId }: { readonly actorId: string | null }) {
  useBrowserEffect(() => {
    if (selectMediaAccount(actorId)) clearAccountResumeRecords();
  }, [actorId]);
  return null;
}
