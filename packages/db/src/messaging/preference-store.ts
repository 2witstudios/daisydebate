import type { AuthorizationTransaction } from '../authorization';
import { invalidateMessagingInboxes } from './inbox-change';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { MessagingAuthorizationFence } from './records';
import { withLockedMessagingAuthority } from './authority-frame';
import { channelPreferenceFrame } from './preference-frame';
import {
  clearOwnMessagingPreference,
  type MessagingPreferenceClearFence,
} from './preference-clear';
/** Dedicated methods always use their own explicit capability, never a caller-selected weaker fence. */
export function createMessagingPreferenceStore(
  database: BunSQLDatabase,
  authorize: {
    readonly read: MessagingAuthorizationFence;
    readonly update: MessagingAuthorizationFence;
    readonly clear: MessagingPreferenceClearFence;
  },
) {
  type Scope = Parameters<MessagingAuthorizationFence>[1];
  const inChannel = <T>(
    scope: Scope,
    work: (
      frame: ReturnType<typeof channelPreferenceFrame>,
      tx: AuthorizationTransaction,
    ) => Promise<T>,
  ) =>
    database.transaction((tx) =>
      withLockedMessagingAuthority(tx, scope, (authority) =>
        work(
          channelPreferenceFrame(tx, scope, (operation) =>
            authorize[operation](tx, scope, authority),
          ),
          tx,
        ),
      ),
    );
  return {
    read: (scope: Scope) => inChannel(scope, (frame) => frame.read()),
    update: (
      scope: Scope,
      selection: Parameters<
        ReturnType<typeof channelPreferenceFrame>['update']
      >[0],
    ) =>
      inChannel(scope, async (frame, tx) => {
        await frame.update(selection);
        const result = await frame.read();
        await invalidateMessagingInboxes(tx, [scope.actorId]);
        return result;
      }),
    clear: (scope: Scope) =>
      database.transaction((tx) =>
        clearOwnMessagingPreference(tx, scope, authorize.clear),
      ),
  };
}
