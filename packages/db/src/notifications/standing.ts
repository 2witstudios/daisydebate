import { notificationKinds, type NotificationKind } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import { challengeOpen } from '../challenges/open';
import { broadcastOnAir } from '../live-broadcast-reads';
import { recordingReady } from '../recording-round-reads';
import { invitationOpen } from '../room-invitations/open';
import { wants } from './preferences';

/**
 * The rows the inbox read joins, by alias: `n` the notification, `r` its
 * Round, `u` the live account it is about, `rc` the Round's Recording, `i`
 * and `ro` the invitation and its Room, `c` the challenge.
 */
export const standingJoins = sql`left join rounds r on r.id=n.round_id
  left join actors a on a.id=n.actor_id
  left join users u on u.id=a.user_id and u.deleted_at is null
  left join recordings rc on rc.round_id=n.round_id
  left join room_invitations i on i.id=n.room_invitation_id
  left join rooms ro on ro.id=i.room_id
  left join challenges c on c.id=n.challenge_id`;

/**
 * Whether a notification of this kind still stands at `now`: what the
 * subject's own feature publishes (ADR 0143). Notifications owns no status
 * words of its own, so a new kind adds its owner's read here and nowhere else.
 */
const subjectStands = (kind: NotificationKind, now: SQL): SQL => {
  switch (kind) {
    case 'followed_debater_live':
      // A follower is sent only to a public Round on air, by a live account.
      return sql`(r.visibility='public' and u.username is not null
        and ${broadcastOnAir(sql`n.round_id`)})`;
    case 'recording_ready':
      return recordingReady(sql`rc`);
    case 'room_invitation':
      return invitationOpen(now, { invitation: sql`i`, room: sql`ro` });
    case 'challenge_received':
      return challengeOpen(now, sql`c`);
  }
};

/**
 * The one standing rule over every kind: a stored row is shown while its
 * subject stands and the member's in-app channel for its kind is on.
 */
export const notificationStands = (now: SQL): SQL =>
  sql`(${sql.join(
    notificationKinds.map(
      (kind) =>
        sql`(n.kind=${kind} and ${subjectStands(kind, now)} and ${wants(kind, 'in_app', sql`n.user_id`)})`,
    ),
    sql` or `,
  )})`;
