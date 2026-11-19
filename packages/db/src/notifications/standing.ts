import { notificationKinds, type NotificationKind } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import { challengeAccepted, challengeOpen } from '../challenges/open';
import { friendRequestOpen, friendshipAccepted } from '../friends/standing';
import { broadcastOnAir } from '../live-broadcast-reads';
import { recordingReady } from '../recording-round-reads';
import { roundDecisionReleased, roundUnderway } from '../round-standing';
import { invitationOpen } from '../room-invitations/open';
import {
  releaseRequestWaiting,
  youthRoundPublic,
} from '../media-release-standing';
import { youthRoundSql } from '../youth-round-sql';

/**
 * The rows the inbox read joins, by alias: `n` the notification, `r` its
 * Round, `u` the live account it is about, `rc` the Round's Recording, `i`
 * and `ro` the invitation and its Room, `c` the challenge, `fr` the friendship,
 * `mrq` a media release request, `mr` a release and `mru` its minor, `mca` and
 * `mco` a club ask and its club, `yp` a Youth Round's publication, `dmp` a
 * message request's DM pair.
 */
export const standingJoins = sql`left join rounds r on r.id=n.round_id
  left join actors a on a.id=n.actor_id
  left join users u on u.id=a.user_id and u.deleted_at is null
  left join recordings rc on rc.round_id=n.round_id
  left join room_invitations i on i.id=n.room_invitation_id
  left join rooms ro on ro.id=i.room_id
  left join challenges c on c.id=n.challenge_id
  left join friendships fr on fr.low_actor_id=n.friendship_low_actor_id
    and fr.high_actor_id=n.friendship_high_actor_id
  left join media_release_requests mrq on mrq.id=n.media_release_request_id
  left join media_releases mr on mr.id=n.media_release_id
  left join users mru on mru.id=mr.user_id and mru.deleted_at is null
  left join media_release_club_asks mca on mca.id=n.media_release_club_ask_id
  left join organizations mco on mco.id=mca.organization_id and mco.closed_at is null
  left join youth_round_publications yp on yp.round_id=n.round_id
  left join messaging_dm_pairs dmp on dmp.channel_id=n.dm_channel_id`;

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
        and not ${youthRoundSql(sql`n.round_id`)}
        and ${broadcastOnAir(sql`n.round_id`)})`;
    case 'recording_ready':
      // A Youth Round's notice stands only for someone who sat in it: a
      // follower's, sent before the Round became private (ADR 0157), lapses.
      return sql`(${recordingReady(sql`rc`)} and (not ${youthRoundSql(sql`n.round_id`)}
        or exists (select 1 from round_participants p join actors a on a.id=p.actor_id
          where p.round_id=n.round_id and a.user_id=n.user_id
            and public.daisy_round_participant_is_current(p.id))))`;
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
    case 'dm_request':
      // Until the request is answered or withdrawn, and only as its sender's.
      return sql`(dmp.request_state='pending'
        and dmp.request_sender_actor_id=n.actor_id)`;
    case 'media_release_requested':
      return releaseRequestWaiting(now, sql`mrq`);
    case 'media_release_declined':
      return sql`(mrq.id is not null)`;
    case 'media_release_signed':
    case 'media_release_club_confirmed':
    case 'media_release_withdrawn':
      return sql`(mr.id is not null)`;
    case 'media_release_club_asked':
      return sql`(mco.id is not null)`;
    case 'youth_round_published':
      return youthRoundPublic(sql`yp`);
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
