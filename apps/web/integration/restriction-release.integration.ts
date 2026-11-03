import { requireTestServices } from '@daisy/config';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { restrictionRules } from '../src/features/moderation/restriction-rules';
import { drawRoomAt } from './room-draw.test-support';
import { playOut, readyTwoHumanJudgeRoom } from './round-judging.test-support';
import {
  launchRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type Member = Fixture['host'];

/** Runs a test and removes what its sanctions leave, which outlive an account. */
const withBans = (body: (f: Fixture) => Promise<void>) =>
  withRoomRuntime(async (f) => {
    try {
      await body(f);
    } finally {
      await f.sql`delete from operator_command_receipts where command_id in ${f.sql(commands)}`;
      await f.sql`delete from moderation_actions where id in (select m.id from moderation_actions m join actors a on a.user_id=m.user_id where a.id in ${f.sql(banned)})`;
      await f.sql`delete from reports where subject_actor_id in ${f.sql(banned)}`;
      await f.sql`delete from outbox where topic in ${f.sql(banned.map(buildUserInboxTopic))}`;
      commands.length = 0;
      banned.length = 0;
    }
  });
const commands: string[] = [];
const banned: string[] = [];

/** A moderator bans `subject` on a report, as the operator route does. */
const ban = async (f: Fixture, subject: Member) => {
  const reportId = createId();
  const commandId = createId();
  commands.push(commandId);
  banned.push(subject.actorId);
  const reporter = await f.member();
  await f.sql`insert into reports(id,reporter_actor_id,subject_actor_id,reason,surface,created_at)
    values(${reportId},${reporter.actorId},${subject.actorId},'hate','online',clock_timestamp())`;
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
  await withBans(async (f) => {
    const room = await f.assemble();
    await ban(f, f.guest);
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
  await withBans(async (f) => {
    const room = await f.assemble();
    await ban(f, f.host);
    const released = await roomRow(f, room.id);
    const closed = await f.command(
      f.guest,
      await f.operations.view(f.guest, room.id),
      { type: 'close' },
    );
    assert({
      given: 'a host banned with a guest seated',
      should: 'make the guest host, with the authority to act as one',
      actual: { released, closedBy: closed.view.status },
      expected: {
        released: {
          status: 'assembling',
          host: f.guest.actorId,
          seats: [f.guest.actorId],
          members: [f.guest.actorId],
        },
        closedBy: 'closed',
      },
    });
  });
});

test('a restricted host with nobody left closes the Room', async () => {
  await withBans(async (f) => {
    const { host } = await f.freshCast();
    const room = (await f.create({}, host)).view;
    await ban(f, host);
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
  await withBans(async (f) => {
    const room = await f.assemble();
    const { roundId } = await launchRuntimeRound(f, room);
    await ban(f, f.guest);
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
  await withBans(async (f) => {
    const { cast, view } = await drawRoomAt(f, 'striking', {
      kind: 'host',
      resolutions: ['One', 'Two', 'Three', 'Four', 'Five'].map(
        (line) => `This house would ${line}`,
      ),
    });
    await ban(f, cast.host);
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
  await withBans(async (f) => {
    const { room, judges } = await readyTwoHumanJudgeRoom(f);
    const { roundId } = await launchRuntimeRound(f, room);
    await ban(f, judges[0]!);
    const judgeBanned = await roundRow(f, roundId);
    await playOut(f, roundId, false);
    await ban(f, f.guest);
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
  await withBans(async (f) => {
    const room = (await f.create({}, f.host)).view;
    await f.sql`insert into room_seat_holds(room_id,actor_id,until)
      values(${room.id},${f.guest.actorId},clock_timestamp()+interval '10 minutes')`;
    await ban(f, f.guest);
    const holds =
      await f.sql`select 1 from room_seat_holds where room_id=${room.id}`;
    assert({
      given: 'a named member with a seat held for them',
      should: 'release the hold, so nobody waits out its time',
      actual: holds.length,
      expected: 0,
    });
  });
});
