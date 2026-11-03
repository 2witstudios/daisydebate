'use client';

import { useEffect } from 'react';
import { clearAccountResumeRecords } from '../rooms/resume-departure';
import { selectMediaAccount } from './account-signout-cleanup';

export function MediaAccount({ actorId }: { readonly actorId: string | null }) {
  useEffect(() => {
    if (selectMediaAccount(actorId)) clearAccountResumeRecords();
  }, [actorId]);
  return null;
}
