'use client';

import { useEffect } from 'react';
import { useUiState, useUiUpdate } from '../store/store';
import { retainPresenceSession } from './presence-session';

/**
 * How many of a member's friends are online, for the rail and the tab bar;
 * null until the first read (and always for a visitor). Joining also keeps
 * the member's own presence live.
 */
export function useFriendsOnline(member: boolean): number | null {
  const update = useUiUpdate();
  useEffect(() => {
    if (!member) return;
    return retainPresenceSession((friendsOnline) =>
      update((state) => ({
        ...state,
        resources: { ...state.resources, friendsOnline },
      })),
    );
  }, [member, update]);
  return useUiState((state) => state.resources.friendsOnline);
}
