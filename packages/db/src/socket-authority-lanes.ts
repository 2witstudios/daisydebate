import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { authorizationSessionOperations } from './authorization-session';
import { createMessagingChannelAuthority } from './messaging/authority-frame';
import { roomAuthorizationRead } from './room-authorization-read';
import type { DatabaseWorkloadProfile } from './workload-admission';

/**
 * Session, channel, room and round authorization reads. Web keeps them on
 * its interactive lanes; realtime pools reserve no social or competitive
 * lane, so socket authorization admits on the admission lane.
 */
export function socketAuthorityOperations(
  profile: DatabaseWorkloadProfile,
  lanes: {
    readonly control: BunSQLDatabase;
    readonly social: BunSQLDatabase;
    readonly competitive: BunSQLDatabase;
    readonly admission: BunSQLDatabase;
  },
) {
  const web = profile === 'web';
  return {
    // Web session reads serve every page render.
    ...authorizationSessionOperations({
      database: web ? lanes.control : lanes.admission,
    }),
    messagingChannelAuthority: createMessagingChannelAuthority(
      web ? lanes.social : lanes.admission,
    ),
    ...roomAuthorizationRead({
      database: web ? lanes.competitive : lanes.admission,
    }),
  };
}
