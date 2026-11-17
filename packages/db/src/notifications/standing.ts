import { notificationKinds, type NotificationKind } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import { challengeAccepted, challengeOpen } from '../challenges/open';
import { friendRequestOpen, friendshipAccepted } from '../friends/standing';
import { broadcastOnAir } from '../live-broadcast-reads';
import { recordingReady } from '../recording-round-reads';
import { roundDecisionReleased, roundUnderway } from '../round-standing';
import { invitationOpen } from '../room-invitations/open';

/**
 * The rows the inbox read joins, by alias: `n` the notification, `r` its
 * Round, `u` the live account it is about, `rc` the Round's Recording, `i`
 * and `ro` the invitation and its Room, `c` the challenge, `fr` the friendship.
 */
export const standingJoins = sql`left join rounds r on r.id=n.round_id
  left join actors a on a.id=n.actor_id
  left join users u on u.id=a.user_id and u.deleted_at is null
  left join recordings rc on rc.round_id=n.round_id
  left join room_invitations i on i.id=n.room_invitation_id
  left join rooms ro on ro.id=i.room_id
  left join challenges c on c.id=n.challenge_id
  left join friendships fr on fr.low_actor_id=n.friendship_low_actor_id
    and fr.high_actor_id=n.friendship_high_actor_id`;

/**
 * The tournament notifications Tab's own read found standing, as a `jsonb`
 * array of ids (NTF-15). Tab's rows are behind lobby-scoped row security, so Tab reads
 * each lobby in its own scope before this query and hands over the ids;
 * a read that asked Tab nothing (a digest: no Tab kind is emailed) passes none.
 */
export type TournamentStanding = SQL;
export const noTournamentStanding: TournamentStanding = sql`'[]'::jsonb`;
export const tournamentStanding = (ids: Iterable<string>): TournamentStanding =>
  sql`${JSON.stringify([...ids])}::text::jsonb`;

/**
 * Whether a notification of this kind still stands at `now`: what the
 * subject's own feature publishes (ADR 0144). Notifications owns no status
 * words of its own, so a new kind adds its owner's read here and nowhere else.
 */
const subjectStands = (
  kind: NotificationKind,
  now: SQL,
  tournament: TournamentStanding,
): SQL => {
  switch (kind) {
    case 'followed_debater_live':
      // A follower is sent only to a public Round on air, by a live account.
      return sql`(r.visibility='public' and u.username is not null
        and ${broadcastOnAir(sql`n.round_id`)})`;
    case 'recording_ready':
      return recordingReady(sql`rc`);
    case 'round_started':
      return roundUnderway(sql`r`);
    case 'round_decision_released':
      return roundDecisionReleased(sql`r`);
    case 'room_invitation':
      return invitationOpen(now, { invitation: sql`i`, room: sql`ro` });
    case 'challenge_received':
      return challengeOpen(now, sql`c`);
    case 'challenge_accepted':
      return challengeAccepted(now, sql`c`);
    case 'friend_request_received':
      return friendRequestOpen(sql`fr`);
    case 'friend_request_accepted':
      return friendshipAccepted(sql`fr`);
    case 'judge_assigned':
    case 'judge_replaced':
    case 'judge_unassigned':
    case 'tournament_draw_changed':
    case 'tournament_room_ready':
    case 'tournament_results_released':
      return sql`(n.id in (select jsonb_array_elements_text(${tournament})))`;
  }
};

/**
 * The one standing rule over every kind: a stored row's subject still stands
 * at `now`. The inbox also asks the in-app choice, a digest the email one.
 */
export const notificationStands = (
  now: SQL,
  tournament: TournamentStanding = noTournamentStanding,
): SQL =>
  sql`(${sql.join(
    notificationKinds.map(
      (kind) =>
        sql`(n.kind=${kind} and ${subjectStands(kind, now, tournament)})`,
    ),
    sql` or `,
  )})`;
