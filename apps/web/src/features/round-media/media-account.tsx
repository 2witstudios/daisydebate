'use client';

import { useEffect } from 'react';
import { selectMediaAccount } from './account-signout-cleanup';

export function MediaAccount({ actorId }: { readonly actorId: string | null }) {
  useEffect(() => selectMediaAccount(actorId), [actorId]);
  return null;
}
