import { requireTestServices } from '@daisy/config';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { exportRoomAccountClosure } from '@daisy/db/testing';
import {
  activeRoomMembers,
  closeRoom,
  eraseSeats,
  readRoundOpening,
  roundWaitingOn,
} from '@daisy/debate-engine';
import { restrictionRules } from '../src/features/moderation/restriction-rules';
import { drawRoomAt } from './room-draw.test-support';
import {
  everyoneReady,
  playOut,
  readyTwoHumanJudgeRoom,
} from './round-judging.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Member = Fixture['host'];

/**
 * Runs a test and removes what its sanctions leave, which outlive an account.
 * The body gets a `ban` that records them.
 */
const withBans = (
  body: (f: Fixture, ban: (subject: Member) => Promise<void>) => Promise<void>,
) =>
  withRoomRuntime(async (f) => {
    const commands: string[] = [];
    const banned: string[] = [];
    try {
      await body(f, (subject) => {
        const commandId = createId();
        commands.push(commandId);
        banned.push(subject.actorId);
        return banOn(f, subject, commandId);
      });
    } finally {
      if (banned.length) {
        await f.sql`delete from operator_command_receipts where command_id in ${f.sql(commands)}`;
        await f.sql`delete from moderation_actions where id in (select m.id from moderation_actions m join actors a on a.user_id=m.user_id where a.id in ${f.sql(banned)})`;
        await f.sql`delete from reports where subject_actor_id in ${f.sql(banned)}`;
        await f.sql`delete from outbox where topic in ${f.sql(banned.map(buildUserInboxTopic))}`;
      }
    }
  });

/** A moderator bans `subject` on a report, as the operator route does. */
const banOn = async (f: Fixture, subject: Member, commandId: string) => {
  const reportId = createId();
  const reporter = await f.member();
  await f.sql`insert into reports(id,reporter_actor_id,subject_actor_id,reason,surface,created_at)
    values(${reportId},${reporter.actorId},${subject.actorId},'hate','people',clock_timestamp())`;
  const now = Date.now();
  await f.store.resolveReport({
    commandId,
    reportId,
    serviceId: 'daisy-admin',
    operatorRef: 'o'.repeat(24),
    resolution: { outcome: 'banned' },
    requestDigest: 'd'.repeat(64),
    adminAuditHead: 'e'.repeat(64),
    now: new Date(now).toISOString(),
    purgeAfter: new Date(now + 86_400_000).toISOString(),
    nextId: createId,
    restrictionRules,
    live: () => true,
  });
};

const roomRow = async (f: Fixture, roomId: string) => {
  const [row] = await f.sql`select r.status, r.host_actor_id as host,
    (select coalesce(json_agg(p.actor_id order by p.role),'[]'::json) from room_participants p where p.room_id=r.id) as seats,
    (select coalesce(json_agg(m.actor_id order by m.actor_id),'[]'::json) from room_active_memberships m where m.room_id=r.id) as members
    from rooms r where r.id=${roomId}`;
  return {
    status: row.status as string,
    host: row.host as string,
    seats: row.seats as string[],
    members: row.members as string[],
  };
};

const roundRow = async (f: Fixture, roundId: string) => {
  const [row] = await f.sql`select r.status, r.outcome,
    (select coalesce(json_agg(json_build_array(c.type,c.service_id,c.actor_id)),'[]'::json) from round_commands c where c.round_id=r.id and c.type='forfeit') as forfeits
    from rounds r where r.id=${roundId}`;
  return row as {
    status: string;
    outcome: string | null;
    forfeits: unknown[];
  };
};

test('a restricted guest frees the seat and the Room stays open for the host', async () => {
  await withBans(async (f, ban) => {
    const room = await f.assemble();
    await ban(f.guest);
    assert({
      given: 'a member banned while seated in a ready Room',
      should: 'free the seat and hold only the others, with the Room open',
      actual: await roomRow(f, room.id),
      expected: {
        status: 'assembling',
        host: f.host.actorId,
        seats: [f.host.actorId],
        members: [f.host.actorId],
      },
    });
  });
});

test('a restricted host passes the Room to the human still seated, who can run it', async () => {
  await withBans(async (f, ban) => {
    const room = await f.assemble();
    const [before] =
      await f.sql`update rooms set last_command_at=clock_timestamp()-interval '1 hour' where id=${room.id} returning last_command_at`;
    await ban(f.host);
    const released = await roomRow(f, room.id);
    const [anchor] =
      await f.sql`select last_command_at > ${before.last_command_at} as moved from rooms where id=${room.id}`;
    const closed = await f.command(
      f.guest,
      await f.operations.view(f.guest, room.id),
      { type: 'close' },
    );
    assert({
      given: 'a host banned with a guest seated',
      should: 'make the guest host, with the authority to act as one',
      actual: { released, anchor, closedBy: closed.view.status },
      expected: {
        released: {
          status: 'assembling',
          host: f.guest.actorId,
          seats: [f.guest.actorId],
          members: [f.guest.actorId],
        },
        anchor: { moved: true },
        closedBy: 'closed',
      },
    });
  });
});

test('a hand-off does not pass a host-written list, in either export or the Room', async () => {
  await withBans(async (f, ban) => {
    const lines = ['One', 'Two', 'Three', 'Four', 'Five'].map(
      (line) => `SENTINEL-LIST ${line}`,
    );
    const { cast, view } = await drawRoomAt(f, 'ready', {
      kind: 'host',
      resolutions: lines,
    });
    await ban(cast.host);
    const exported = (member: Member) =>
      exportRoomAccountClosure(
        f.sql,
        {
          closeRoom,
          eraseSeats,
          activeRoomMembers,
        },
        member,
      );
    const [stored] =
      await f.sql`select config::text || execution_plan::text as text, host_actor_id as host from rooms where id=${view.id}`;
    assert({
      given: 'a banned host whose Room held their own list',
      should: 'pass the Room with the draw on the bank and no copy of the text',
      actual: {
        host: stored.host,
        kept: (stored.text as string).includes('SENTINEL-LIST'),
        author: (await exported(cast.host)).room_resolution_lists,
        heir: (await exported(cast.guest)).room_resolution_lists,
      },
      expected: {
        host: cast.guest.actorId,
        kept: false,
        author: [],
        heir: [],
      },
    });
  });
});

test('a debater who inherits a Room never learns the hidden judge, in the Room or its Round', async () => {
  await withBans(async (f, ban) => {
    const { room, judges } = await readyTwoHumanJudgeRoom(f);
    const [judge, lateJudgeSeatHolder] = judges;
    const secrets = async () => {
      const own = await f.operations.view(judge!, room.id);
      const seat = own.participants.find(
        (p) => 'actorId' in p && p.actorId === judge!.actorId,
      );
      if (!seat || !('label' in seat))
        throw Error('Judge reads their own seat');
      return [judge!.actorId, seat.id, seat.label];
    };
    const named = await secrets();
    const leaked = (value: unknown) =>
      named.filter((secret) => JSON.stringify(value).includes(secret));
    await ban(f.host);
    const heir = f.guest;

    const roomRead = await f.operations.view(heir, room.id);
    const third = await f.member();
    const claimed = (
      await f.command(third, roomRead, {
        type: 'claim-seat',
        role: 'affirmative',
        slot: 0,
      })
    ).view;
    const everyone = await everyoneReady(f, claimed, [
      heir,
      third,
      judge!,
      lateJudgeSeatHolder!,
    ]);
    const heirRoom = await f.operations.view(heir, room.id);
    const command = await f.command(heir, heirRoom, { type: 'start-round' });
    const roundId = command.view.roundRef!.id;
    const round = await f.store.readLaunchedRound(
      roundId,
      heir,
      () => true,
      readRoundOpening,
      roundWaitingOn,
    );
    const judgeRound = await f.store.readLaunchedRound(
      roundId,
      judge!,
      () => true,
      readRoundOpening,
      roundWaitingOn,
    );
    const [frozen] =
      await f.sql`select host_inherited,created_by_actor_id from rounds where id=${roundId}`;
    assert({
      given:
        'a hand-off with human judges seated, then the Round the heir starts',
      should:
        'name them through no Room read, command answer or Round read, while the heir stays host',
      actual: {
        leaks: {
          roomRead: leaked(roomRead),
          afterCommand: leaked(claimed),
          ready: leaked(everyone),
          startAnswer: leaked(command.view),
          round: leaked(round),
        },
        capabilityHost: roomRead.capabilities.host,
        viewerIsHost: round.viewerIsHost,
        frozen,
        judgeSeesThemselves: leaked(judgeRound).length > 0,
      },
      expected: {
        leaks: {
          roomRead: [],
          afterCommand: [],
          ready: [],
          startAnswer: [],
          round: [],
        },
        capabilityHost: true,
        viewerIsHost: true,
        frozen: { host_inherited: true, created_by_actor_id: heir.actorId },
        judgeSeesThemselves: true,
      },
    });
  });
});

test('a restricted host with nobody left closes the Room', async () => {
  await withBans(async (f, ban) => {
    const { host } = await f.freshCast();
    const room = (await f.create({}, host)).view;
    await ban(host);
    assert({
      given: 'a host banned alone in their Room',
      should: 'close it and hold no one',
      actual: await roomRow(f, room.id),
      expected: {
        status: 'closed',
        host: host.actorId,
        seats: [],
        members: [],
      },
    });
  });
});

test('a restriction forfeits a Round being debated, recorded as a forfeit and rated as one', async () => {
  await withBans(async (f, ban) => {
    const room = await f.assemble();
    const { roundId } = await launchRuntimeRound(f, room);
    await ban(f.guest);
    const facts = await f.store.readRatingFacts(roundId);
    assert({
      given: 'the Negative banned during an active Round',
      should: 'end it for the Affirmative, naming the service, not the member',
      actual: {
        round: await roundRow(f, roundId),
        ending: facts?.ending,
        members: (await roomRow(f, room.id)).members,
      },
      expected: {
        round: {
          status: 'completed',
          outcome: 'affirmative',
          forfeits: [['forfeit', 'moderation-restriction', null]],
        },
        ending: 'forfeit',
        members: [],
      },
    });
  });
});

test('a restriction forfeits a Round still in its opening', async () => {
  await withBans(async (f, ban) => {
    const { cast, view } = await drawRoomAt(f, 'striking', {
      kind: 'host',
      resolutions: ['One', 'Two', 'Three', 'Four', 'Five'].map(
        (line) => `This house would ${line}`,
      ),
    });
    await ban(cast.host);
    const round = await roundRow(f, view.roundRef!.id);
    assert({
      given: 'the Affirmative banned during the strikes',
      should: 'stand as a result for the Negative',
      actual: [round.status, round.outcome],
      expected: ['completed', 'negative'],
    });
  });
});

test('a restriction leaves alone a Round whose debate is over, and a judge seat', async () => {
  await withBans(async (f, ban) => {
    const { room, judges } = await readyTwoHumanJudgeRoom(f);
    const { roundId } = await launchRuntimeRound(f, room);
    await ban(judges[0]!);
    const judgeBanned = await roundRow(f, roundId);
    await playOut(f, roundId, false);
    await ban(f.guest);
    const debaterBanned = await roundRow(f, roundId);
    assert({
      given: 'a judge banned mid-debate, then a debater after the last speech',
      should: 'forfeit nothing, leaving the ballot to decide',
      actual: [
        judgeBanned.forfeits,
        debaterBanned.forfeits,
        debaterBanned.outcome,
      ],
      expected: [[], [], null],
    });
  });
});

test('a seat held for a restricted member stops holding', async () => {
  await withBans(async (f, ban) => {
    const room = (await f.create({}, f.host)).view;
    await f.sql`insert into room_seat_holds(room_id,actor_id,seat,until)
      values(${room.id},${f.guest.actorId},'debater',clock_timestamp()+interval '10 minutes')`;
    const [before] =
      await f.sql`select version,change_version from rooms where id=${room.id}`;
    await ban(f.guest);
    const holds =
      await f.sql`select 1 from room_seat_holds where room_id=${room.id}`;
    const [after] =
      await f.sql`select version,change_version from rooms where id=${room.id}`;
    const rungs =
      await f.sql`select 1 from outbox where topic=${`room:${room.id}`} and kind='room.changed' and (payload->>'entityVersion')::int=${after.change_version}`;
    assert({
      given: 'a named member with a seat held for them',
      should:
        'release the hold and ring the Room, asking nobody to ready again',
      actual: {
        holds: holds.length,
        changed: after.change_version - before.change_version,
        version: after.version - before.version,
        rungs: rungs.length,
      },
      expected: { holds: 0, changed: 1, version: 0, rungs: 1 },
    });
  });
});

test('a corrupt Round does not stop the sanction, and is reported', async () => {
  await withBans(async (f, ban) => {
    const room = await f.assemble();
    const { roundId } = await launchRuntimeRound(f, room);
    await f.sql`update rounds set runtime_state='{"broken":true}'::jsonb where id=${roundId}`;
    await ban(f.guest);
    const [sanction] =
      await f.sql`select m.kind from moderation_actions m join actors a on a.user_id=m.user_id where a.id=${f.guest.actorId}`;
    assert({
      given: 'a debater banned during a Round whose stored state is corrupt',
      should: 'commit the ban and leave that Round for repair',
      actual: [sanction?.kind, (await roundRow(f, roundId)).status],
      expected: ['ban', 'active'],
    });
  });
});
