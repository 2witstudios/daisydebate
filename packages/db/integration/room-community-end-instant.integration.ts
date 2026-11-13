import { requireTestServices } from '@daisy/config';
import {
  activeRoomMembers,
  closeRoom,
  decideInvitationEnd,
  decideRoomInvitation,
  eraseSeats,
  maintainRoom,
  releaseRestrictedMember,
} from '@daisy/debate-engine';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomCommandTransaction } from '../src/room-command-transaction';
import { roomInvitationOperations } from '../src/room-invitations/store';
import { roomLifecycleOperations } from '../src/room-lifecycle-operations';
import { releaseMemberFromRooms } from '../src/room-restriction-release';
import { eraseRoomAccountClosure } from '../src/testing-room-account-closure';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
/** When the Room ended, long before the writers below run. */
const ended = '2026-01-01T00:00:00.000Z';
type Member = { readonly userId: string; readonly actorId: string };

/** What a writer answered: it ran, or the code it refused with. */
const attempt = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return 'ran';
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
};

/**
 * A Room with a host, a seated debater and a pending judge invitation, then
 * every writer that can still reach a Room outside its own commands:
 * invitations (invite, withdraw, decline), a restriction's release of each
 * member, account closure of each member and maintenance.
 */
const afterEveryWriter = (
  status: 'assembling' | 'started' | 'closed',
  body: (result: {
    readonly updatedAt: string;
    readonly status: string;
    readonly candidate: boolean;
    readonly maintained: boolean;
    readonly invitations: readonly string[];
  }) => void,
) =>
  withFixture(databaseUrl, async (f: Fixture) => {
    const host = await createAuthorizationSubject(f);
    const debater = await createAuthorizationSubject(f);
    const invitee = await createAuthorizationSubject(f);
    const latecomer = await createAuthorizationSubject(f);
    const roomId = await f.room(host.actorId, await f.format(), {
      config: validConfig,
      execution_plan: {
        preRoundPrep: { enabled: false },
        resolutionDraw: { enabled: false },
      },
      rules_snapshot: {
        ...validRules,
        seats: { ...validRules.seats, judge: 1 },
      },
    });
    const database = drizzle({ client: f.sql });
    const transaction = roomCommandTransaction(f.sql, 2);
    const invitations = roomInvitationOperations({ database, transaction });
    const lifecycle = roomLifecycleOperations({
      database,
      commandTransaction: transaction,
    });
    const invite = (member: Member, seat: 'debater' | 'judge') =>
      invitations.inviteToRoom({
        caller: host,
        roomId,
        username: member.userId,
        seat,
        ids: {
          invitation: createId(),
          notification: createId(),
          emailJob: createId(),
        },
        admitted: (account) => account?.beta?.state === 'approved',
        decide: (facts) =>
          decideRoomInvitation({ ...facts, callerActorId: host.actorId, seat }),
      });
    const end = (caller: Member, invitationId: string) => {
      const how = caller === host ? 'withdraw' : 'decline';
      return invitations.endRoomInvitation({
        caller,
        invitationId,
        end: how,
        decide: (facts) =>
          decideInvitationEnd({
            ...facts,
            callerActorId: caller.actorId,
            end: how,
          }),
      });
    };
    try {
      await f.sql`insert into room_participants(id,room_id,actor_id,role,slot) values(${createId()},${roomId},${debater.actorId},'affirmative',0)`;
      const { invitationId } = await invite(invitee, 'judge');
      // A started Room always names the Round it launched.
      if (status === 'started')
        await f.round({
          room_id: roomId,
          created_by_actor_id: host.actorId,
          room_config_snapshot: validConfig,
          visibility: 'public',
        });
      // The Room ends as a Room command ends it, at a known earlier instant.
      await f.sql`update rooms set status=${status},version=version+1,change_version=change_version+1,updated_at=${ended}::timestamptz,last_command_at=${ended}::timestamptz where id=${roomId}`;
      const now = new Date().toISOString();
      const invitationAnswers = [
        await attempt(() => invite(latecomer, 'debater')),
        await attempt(() => end(invitee, invitationId)),
        await attempt(() => end(host, invitationId)),
      ];
      for (const member of [invitee, debater, host])
        await f.sql.begin((tx) =>
          releaseMemberFromRooms(
            drizzle({ client: tx }) as unknown as Parameters<
              typeof releaseMemberFromRooms
            >[0],
            member.actorId,
            {
              now,
              rules: {
                releaseMember: releaseRestrictedMember,
                activeRoomMembers,
              },
            },
          ),
        );
      const candidate = (
        await lifecycle.readMaintenanceCandidates({
          idleTimeoutMs: 1,
          limit: 1024,
        })
      ).includes(roomId);
      const maintained = await lifecycle.maintainRoom({
        roomId,
        maintain: (state, facts) =>
          maintainRoom(state, { ...facts, idleTimeoutMs: 1 }),
      });
      for (const member of [debater, host])
        await eraseRoomAccountClosure(
          f.sql,
          { closeRoom, eraseSeats, activeRoomMembers },
          member,
          now,
        );
      const [room] =
        await f.sql`select status,updated_at from rooms where id=${roomId}`;
      body({
        updatedAt: new Date(room.updated_at).toISOString(),
        status: room.status,
        candidate,
        maintained,
        invitations: invitationAnswers,
      });
    } finally {
      await f.sql`delete from outbox where topic=${`room:${roomId}`}
        or (payload->>'kind'='user.notification-delivered' and (payload->'ids'->>0) in
          (select n.id from notifications n join room_invitations i on i.id=n.room_invitation_id
            where i.room_id=${roomId}))`;
    }
  });

for (const status of ['started', 'closed'] as const)
  test(`no writer moves the end instant of a ${status} Room (ADR 0126)`, async () =>
    afterEveryWriter(status, (result) =>
      assert({
        given: `a ${status} Room, then invitations, each member’s restriction release, maintenance and each member’s account closure`,
        should:
          'leave updated_at, which Room chat reads as the Room’s end, and the status exactly as the Room left them',
        actual: {
          updatedAt: result.updatedAt,
          status: result.status,
          candidate: result.candidate,
          maintained: result.maintained,
          invitations: result.invitations,
        },
        expected: {
          updatedAt: ended,
          status,
          candidate: false,
          maintained: false,
          // The Room was ended here by a bare write, so its invitation is
          // still pending and the invitee's decline is a writer that runs.
          invitations: ['CONFLICT', 'ran', 'CONFLICT'],
        },
      }),
    ));

test('the same writers do move an open Room, so the pin above is not vacuous', async () =>
  afterEveryWriter('assembling', (result) =>
    assert({
      given: 'an open Room under the same writers',
      should: 'write the Room: its last write is no longer the earlier instant',
      actual: [result.updatedAt === ended, result.status],
      expected: [false, 'closed'],
    }),
  ));
