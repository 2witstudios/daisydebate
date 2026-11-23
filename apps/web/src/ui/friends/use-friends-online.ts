'use client';

// First: protocol schemas built after this load without Zod's eval probe.
import '../../lib/zod-jitless';
import { useResource } from '../edge/use-driver';

import { useUiState, useUiUpdate } from '../store/store';
import { retainPresenceSession } from './presence-session';

/**
 * How many of a member's friends are online, for the rail and the tab bar;
 * null until the first read (and always for a visitor). Joining also keeps
 * the member's own presence live.
 */
export function useFriendsOnline(member: boolean): number | null {
  const update = useUiUpdate();
  useResource(member, (joined) =>
    joined
      ? {
          dispose: retainPresenceSession((friendsOnline) =>
            update((state) => ({
              ...state,
              resources: { ...state.resources, friendsOnline },
            })),
          ),
        }
      : null,
  );
  return useUiState((state) => state.resources.friendsOnline);
}
