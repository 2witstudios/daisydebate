import { createAppError, createRefusal } from '@daisy/errors';
import {
  settledRoomInvitations,
  type InvitationDecision,
  type InvitationEndDecision,
  type InviteeFacts,
  type PendingRoomInvitation,
  type RoomAssemblyState,
  type RoomInvitationView,
  type RoomSeatKind,
} from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { eq, sql } from 'drizzle-orm';
import { lockAuthorizationActors } from '../authorization';
import type { authorizationAccountFact } from '../authorization-account';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { oweNotification } from '../notifications/inbox';
import { rowsOf } from '../raw-rows';
import {
  appendRoomChanged,
  roomFacts,
  transactionNow,
  type Caller,
  type Tx,
} from '../room-command-facts';
import type { roomCommandTransaction } from '../room-command-transaction';
import { deleteExpiredBatch, type RetentionBatch } from '../retention';
import { roomInvitations } from '../schema/room-invitations';
import { rooms } from '../schema/rooms';

type Account = ReturnType<typeof authorizationAccountFact>;

const pendingRows = (tx: Tx, roomId: string, now: string) =>
  rowsOf<PendingRoomInvitation>(
    tx,
    sql`select id,invitee_actor_id as "inviteeActorId",inviter_actor_id as "inviterActorId",seat,
        to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "expiresAt"
      from room_invitations where room_id=${roomId} and state='pending' and expires_at>${now}::timestamptz
      order by created_at,id`,
  );

/** A Room's invitations whose time ran out end as expired, and free their holds. */
const lapse = async (tx: Tx, roomId: string, now: string) => {
  const lapsed = await rowsOf<{ invitee_actor_id: string }>(
    tx,
    sql`update room_invitations set state='expired',ended_at=${now}::timestamptz
      where room_id=${roomId} and state='pending' and expires_at<=${now}::timestamptz
      returning invitee_actor_id`,
  );
  for (const { invitee_actor_id } of lapsed)
    await tx.execute(
      sql`delete from room_seat_holds where room_id=${roomId} and actor_id=${invitee_actor_id}`,
    );
};

/** Whether a block stands between two actors, either way. */
const blocked = async (tx: Tx, a: string, b: string) =>
  (
    await rowsOf(
      tx,
      sql`select 1 from contact_pairs where low_actor_id=${a < b ? a : b} and high_actor_id=${a < b ? b : a}
        and (low_blocks_high or high_blocks_low)`,
    )
  ).length > 0;

/** The Room row locked, then its state; touching it bumps only the sync version. */
const lockRoom = async (tx: Tx, roomId: string) => {
  const [row] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .for('update');
  if (!row) throw createAppError('NOT_FOUND');
  return (await roomFacts(tx, row)).state;
};
const touchRoom = async (tx: Tx, room: RoomAssemblyState) => {
  const changeVersion = room.changeVersion + 1;
  await tx.update(rooms).set({ changeVersion }).where(eq(rooms.id, room.id));
  await appendRoomChanged(tx, room.id, changeVersion);
};

/**
 * Room invitations (ADR 0124): a host names a member for a seat kind, the
 * invitation holds that seat, and the invitee is told in the same
 * transaction. Commands take the Room row lock, so they serialize with Room
 * commands; the decision itself is the caller's pure rule.
 */
export const roomInvitationOperations = ({
  database,
  transaction,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'execute'>;
  readonly transaction: ReturnType<typeof roomCommandTransaction>;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * A Room's live invitations as one viewer may see them: the host sees
   * every one, an invitee only their own, anyone else none.
   */
  readRoomInvitations(input: {
    readonly roomId: string;
    readonly viewerActorId: string;
    readonly now: string;
  }): Promise<readonly RoomInvitationView[]> {
    return instrumented(eventSink, 'readRoomInvitations', () =>
      rowsOf<RoomInvitationView>(
        database,
        sql`select i.id,i.seat,coalesce(iu.username,'') as invitee,coalesce(hu.username,'') as inviter,
            to_char(i.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "expiresAt"
          from room_invitations i join rooms r on r.id=i.room_id
          join actors ia on ia.id=i.invitee_actor_id left join users iu on iu.id=ia.user_id
          join actors ha on ha.id=i.inviter_actor_id left join users hu on hu.id=ha.user_id
          where i.room_id=${input.roomId} and i.state='pending' and i.expires_at>${input.now}::timestamptz
            and (r.host_actor_id=${input.viewerActorId} or i.invitee_actor_id=${input.viewerActorId})
          order by i.created_at,i.id`,
      ),
    );
  },
  inviteToRoom(input: {
    readonly caller: Caller;
    readonly roomId: string;
    readonly username: string;
    readonly seat: RoomSeatKind;
    readonly ids: {
      readonly invitation: string;
      readonly notification: string;
      readonly emailJob: string;
    };
    /** The participant admission rule over the invitee's locked account. */
    readonly admitted: (account: Account) => boolean;
    readonly decide: (facts: {
      readonly room: RoomAssemblyState;
      readonly invitee: InviteeFacts;
      readonly pending: readonly PendingRoomInvitation[];
      readonly now: string;
    }) => InvitationDecision;
  }): Promise<{ readonly invitationId: string }> {
    return instrumented(eventSink, 'inviteToRoom', () =>
      transaction(async (tx) => {
        const [found] = await rowsOf<{ actor_id: string; user_id: string }>(
          tx,
          sql`select a.id as actor_id,u.id as user_id from users u
            join actors a on a.user_id=u.id and a.kind='human'
            where lower(u.username)=lower(${input.username}) and u.deleted_at is null`,
        );
        const actorIds = [
          ...new Set([
            input.caller.actorId,
            ...(found ? [found.actor_id] : []),
          ]),
        ].sort();
        const accounts = await lockAuthorizationActors(tx, actorIds, {
          maxActors: 2,
        });
        const room = await lockRoom(tx, input.roomId);
        const now = await transactionNow(tx);
        await lapse(tx, room.id, now);
        const inviteeAccount = found
          ? (accounts.find((account) => account?.actorId === found.actor_id) ??
            null)
          : null;
        const invitee: InviteeFacts = found
          ? {
              actorId: found.actor_id,
              eligible:
                inviteeAccount !== null &&
                !inviteeAccount.erased &&
                input.admitted(inviteeAccount),
              blocked: await blocked(tx, room.hostActorId, found.actor_id),
            }
          : null;
        const decision = input.decide({
          room,
          invitee,
          pending: await pendingRows(tx, room.id, now),
          now,
        });
        if (!decision.ok) throw createRefusal('CONFLICT', decision.refusal);
        if (decision.kind === 'repeat')
          return { invitationId: decision.invitationId };
        if (!found) throw createAppError('INVARIANT');
        await tx.execute(sql`insert into room_invitations(id,room_id,invitee_actor_id,inviter_actor_id,seat,state,expires_at,created_at)
          values(${input.ids.invitation},${room.id},${decision.inviteeActorId},${input.caller.actorId},
            ${decision.seat},'pending',${decision.expiresAt}::timestamptz,${now}::timestamptz)`);
        await tx.execute(sql`insert into room_seat_holds(room_id,actor_id,seat,until)
          values(${room.id},${decision.inviteeActorId},${decision.seat},${decision.expiresAt}::timestamptz)
          on conflict (room_id,actor_id) do update set seat=excluded.seat,until=excluded.until`);
        await touchRoom(tx, room);
        // One email an hour per host, member and Room, however often the
        // host withdraws and invites again: only an email this Room's earlier
        // invitation actually sent counts, since a queued one for an ended
        // invitation is cancelled at send time. The inbox row is always written.
        const [recent] = await rowsOf(
          tx,
          sql`select 1 from room_invitations i
            join notifications n on n.room_invitation_id=i.id
            join notification_emails j on j.notification_id=n.id
            where i.room_id=${room.id} and i.inviter_actor_id=${input.caller.actorId}
              and i.invitee_actor_id=${found.actor_id} and i.id<>${input.ids.invitation}
              and j.state='sent'
              and j.completed_at > ${now}::timestamptz - interval '1 hour' limit 1`,
        );
        await oweNotification(tx, {
          kind: 'room_invitation',
          id: input.ids.notification,
          emailJobId: recent ? null : input.ids.emailJob,
          recipient: { userId: found.user_id, actorId: found.actor_id },
          actorId: input.caller.actorId,
          roomInvitationId: input.ids.invitation,
          at: now,
        });
        return { invitationId: input.ids.invitation };
      }),
    );
  },
  /**
   * Retention: an ended invitation goes 30 days after it ended (ADR 0124).
   * One whose time ran out in a Room nothing touched since ends first, as
   * expired at its own expiry, so it is purged on the same clock.
   */
  purgeEndedRoomInvitations(batch: RetentionBatch) {
    return instrumented(eventSink, 'purgeEndedRoomInvitations', async () => {
      await database.execute(sql`update room_invitations set state='expired',ended_at=expires_at
        where id in (select id from room_invitations where state='pending'
          and expires_at <= clock_timestamp() order by id limit ${batch.limit})`);
      return deleteExpiredBatch(
        database,
        {
          table: roomInvitations,
          key: roomInvitations.id,
          at: roomInvitations.endedAt,
        },
        batch,
      );
    });
  },
  /** The invitee declines, or the host withdraws; the seat it held is free again. */
  endRoomInvitation(input: {
    readonly caller: Caller;
    readonly invitationId: string;
    readonly end: 'decline' | 'withdraw';
    readonly decide: (facts: {
      readonly invitation: PendingRoomInvitation | null;
      readonly hostActorId: string;
      readonly now: string;
    }) => InvitationEndDecision;
  }): Promise<{ readonly roomId: string }> {
    return instrumented(eventSink, 'endRoomInvitation', () =>
      transaction(async (tx) => {
        const [owner] = await rowsOf<{ room_id: string }>(
          tx,
          sql`select room_id from room_invitations where id=${input.invitationId}`,
        );
        if (!owner) throw createRefusal('CONFLICT', 'invitation-ended');
        await lockAuthorizationActors(tx, [input.caller.actorId], {
          maxActors: 1,
        });
        const room = await lockRoom(tx, owner.room_id);
        const now = await transactionNow(tx);
        const invitation =
          (await pendingRows(tx, room.id, now)).find(
            (row) => row.id === input.invitationId,
          ) ?? null;
        const decision = input.decide({
          invitation,
          hostActorId: room.hostActorId,
          now,
        });
        if (!decision.ok || !invitation)
          throw createRefusal(
            'CONFLICT',
            decision.ok ? 'invitation-ended' : decision.refusal,
          );
        await tx.execute(sql`update room_invitations set state=${decision.state},ended_at=${now}::timestamptz
          where id=${invitation.id}`);
        await tx.execute(
          sql`delete from room_seat_holds where room_id=${room.id} and actor_id=${invitation.inviteeActorId}`,
        );
        await touchRoom(tx, room);
        return { roomId: room.id };
      }),
    );
  },
});

/**
 * Applies a Room change to its pending invitations under the Room row lock
 * the change holds (ADR 0124): the protocol's rule names which end,
 * accepted or expired, and each ended one frees the seat it held.
 */
export async function settleRoomInvitationsAfter(
  tx: Tx,
  room: RoomAssemblyState,
  now: string,
) {
  // An invitation whose time ran out ends now, whatever else changed.
  await lapse(tx, room.id, now);
  const ended = settledRoomInvitations(
    room,
    await pendingRows(tx, room.id, now),
  );
  for (const invitation of ended) {
    await tx.execute(sql`update room_invitations set state=${invitation.state},ended_at=${now}::timestamptz
      where id=${invitation.id} and state='pending'`);
    await tx.execute(
      sql`delete from room_seat_holds where room_id=${room.id} and actor_id=${invitation.inviteeActorId}`,
    );
  }
}

/**
 * A restricted member's pending invitations, sent or received, end as
 * expired and free their holds (ADR 0124), under each Room's row lock taken
 * in id order. Returns the Rooms whose invitations ended, for the caller to
 * ring.
 */
export async function endMemberRoomInvitations(
  tx: Tx,
  actorId: string,
  now: string,
): Promise<readonly string[]> {
  const involved = await rowsOf<{ room_id: string }>(
    tx,
    sql`select distinct room_id from room_invitations where state='pending'
      and (invitee_actor_id=${actorId} or inviter_actor_id=${actorId}) order by room_id`,
  );
  if (involved.length === 0) return [];
  const roomIds = involved.map((row) => row.room_id);
  await tx.execute(
    sql`select id from rooms where id in (${sql.join(
      roomIds.map((id) => sql`${id}`),
      sql`,`,
    )}) order by id for update`,
  );
  const ended = await rowsOf<{ room_id: string; invitee_actor_id: string }>(
    tx,
    sql`update room_invitations set state='expired',ended_at=${now}::timestamptz
      where state='pending' and (invitee_actor_id=${actorId} or inviter_actor_id=${actorId})
      returning room_id,invitee_actor_id`,
  );
  for (const { room_id, invitee_actor_id } of ended)
    await tx.execute(
      sql`delete from room_seat_holds where room_id=${room_id} and actor_id=${invitee_actor_id}`,
    );
  return [...new Set(ended.map((row) => row.room_id))].sort();
}
