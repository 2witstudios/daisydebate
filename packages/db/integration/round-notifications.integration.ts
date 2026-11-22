import { requireTestServices } from '@daisy/config';
import { buildRoomTopic } from '@daisy/protocol/topics';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol/round';
import { type RoundProjection } from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomCommandOperations } from '../src/room-command-operations';
import { roomCommandTransaction } from '../src/room-command-transaction';
import {
  releaseRoundDecision,
  resurfaceRoundDecision,
} from '../src/round-decision-release';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from '../src/round-projection-writer';
import { createCasualJudgeAdmission } from '../src/casual-judge-admission';
import { createAuthorizationSubject } from './authorization.test-support';
import { betaAllowance } from './bot-admission.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
import { judgedRound } from './judged-round.test-support';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneDefinition, oneOnOneSettings } from '../src/reference-formats';
import { validConfig } from './round-fixtures';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Who holds each kind of row for this Round, by user, sorted. */
const told = async (f: Fixture, roundId: string, kind: string) =>
  (
    (await f.sql`select user_id,read_at is null as unread from notifications
      where round_id=${roundId} and kind=${kind} order by user_id`) as {
      user_id: string;
      unread: boolean;
    }[]
  ).map((row) => row.user_id);

const rings = async (f: Fixture, actorId: string) =>
  (
    (await f.sql`select count(*)::int as n from outbox
      where topic=${`user:${actorId}:inbox`} and kind='user.notification-delivered'`) as {
      n: number;
    }[]
  )[0]!.n;

const projection = (
  round: NonNullable<RoundProjection['round']>,
): RoundProjection => ({
  round,
  segmentInserts: [],
  segmentCloses: [],
  effects: [],
});

/** Moves a fixture Round to `status` through the projection writer. */
const advance = (f: Fixture, roundId: string, status: 'active' | 'completed') =>
  drizzle({ client: f.sql }).transaction(async (tx) => {
    const now = new Date().toISOString();
    const current = await lockedRoundVersion(tx, roundId);
    const stored = (await f.sql`select rules_snapshot as rules from rounds
      where id=${roundId}`) as { rules: RoundRules }[];
    const checkpoint = emptyRuntimeCheckpointFor(stored[0]!.rules);
    await writeProjectionWithPhaseSignal(
      tx,
      roundId,
      current,
      projection(
        status === 'active'
          ? {
              status,
              currentStage: 'countdown',
              startedAt: now,
              completedAt: null,
              outcome: null,
              checkpoint,
            }
          : {
              status,
              currentStage: null,
              startedAt: current.startedAt?.toISOString() ?? now,
              completedAt: now,
              outcome: { kind: 'winner', side: 'affirmative' },
              checkpoint,
            },
      ),
      now,
    );
  });

/** A Round in its opening: two seated members and a bot judge. */
const openingRound = async (f: Fixture) => {
  // Tab's foundation fixture seats no judge (TAB-6): use a judged revision.
  const roundId = await judgedRound(f);
  const affirmative = await f.seat(roundId, 'affirmative');
  const negative = await f.seat(roundId, 'negative');
  const bot = createId();
  await f.insert('actors', { id: bot, kind: 'bot' });
  await f.seat(roundId, 'judge', 0, bot);
  const userOf = async (actorId: string) =>
    (
      (await f.sql`select user_id from actors where id=${actorId}`) as {
        user_id: string;
      }[]
    )[0]!.user_id;
  return {
    roundId,
    affirmative: { ...affirmative, userId: await userOf(affirmative.actorId) },
    negative: { ...negative, userId: await userOf(negative.actorId) },
  };
};

test('a Round that opens first tells its seats only when its clock starts', async () => {
  await withFixture(databaseUrl, async (f) => {
    const round = await openingRound(f);
    const humans = [round.affirmative.userId, round.negative.userId].sort();
    const atOpening = await told(f, round.roundId, 'round_started');
    await advance(f, round.roundId, 'active');
    const started = await told(f, round.roundId, 'round_started');
    assert({
      given:
        'a Round in its opening (prep or a topic draw), then its opening ending, with a bot judge',
      should:
        'owe nothing while it opens, then tell each seated human once and the bot nothing',
      actual: { atOpening, started },
      expected: { atOpening: [], started: humans },
    });
  });
});

test('a finalized Round tells each seated human its decision, unless its release is held', async () => {
  await withFixture(databaseUrl, async (f) => {
    const open = await openingRound(f);
    const held = await openingRound(f);
    await f.sql`update rounds set decision_release='held' where id=${held.roundId}`;
    for (const round of [open, held]) {
      await advance(f, round.roundId, 'active');
      await advance(f, round.roundId, 'completed');
    }
    const openTold = await told(f, open.roundId, 'round_decision_released');
    const heldBefore = await told(f, held.roundId, 'round_decision_released');
    await drizzle({ client: f.sql }).transaction((tx) =>
      releaseRoundDecision(tx, {
        roundId: held.roundId,
        at: new Date().toISOString(),
        recipients: [
          { userId: held.negative.userId, about: held.affirmative.actorId },
        ],
      }),
    );
    const [about] = (await f.sql`select actor_id from notifications
      where round_id=${open.roundId} and kind='round_decision_released'
        and user_id=${open.affirmative.userId}`) as { actor_id: string }[];
    assert({
      given:
        'an open-play Round and a held one, both finalized, then the held one released to one member',
      should:
        'tell each human of the open Round about the member across, and the held Round only whom its release names',
      actual: {
        openTold,
        about: about?.actor_id,
        heldBefore,
        heldAfter: await told(f, held.roundId, 'round_decision_released'),
      },
      expected: {
        openTold: [open.affirmative.userId, open.negative.userId].sort(),
        about: open.negative.actorId,
        heldBefore: [],
        heldAfter: [held.negative.userId],
      },
    });
  });
});

test('a ready analysis brings the decision back unread and rings', async () => {
  await withFixture(databaseUrl, async (f) => {
    const round = await openingRound(f);
    await advance(f, round.roundId, 'active');
    await advance(f, round.roundId, 'completed');
    await f.sql`update notifications set read_at=now()
      where round_id=${round.roundId} and kind='round_decision_released'`;
    const ringsBefore = await rings(f, round.affirmative.actorId);
    const moved = await drizzle({ client: f.sql }).transaction((tx) =>
      resurfaceRoundDecision(tx, {
        roundId: round.roundId,
        userIds: [round.affirmative.userId],
        at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const rows = (await f.sql`select user_id,read_at is null as unread,
        surfaced_at > created_at as surfaced
      from notifications where round_id=${round.roundId}
        and kind='round_decision_released' order by user_id`) as {
      user_id: string;
      unread: boolean;
      surfaced: boolean;
    }[];
    assert({
      given:
        'a read decision notification, then one debater’s analysis published',
      should:
        'bring only that debater’s same row back unread at the top, and ring them once more',
      actual: {
        moved,
        rows: rows.map((row) => [row.user_id, row.unread, row.surfaced]),
        rang: (await rings(f, round.affirmative.actorId)) - ringsBefore,
      },
      expected: {
        moved: 1,
        rows: [
          [round.affirmative.userId, true, true],
          [round.negative.userId, false, false],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        rang: 1,
      },
    });
  });
});

test('a Round with nothing to run first tells its seated humans at the Start', async () => {
  await withFixture(databaseUrl, async (f) => {
    const host = await createAuthorizationSubject(f);
    const guest = await createAuthorizationSubject(f);
    // Tab's foundation seats no judge (TAB-6): the Room runs a judged revision.
    const judged = resolveRoomConfiguration(
      oneOnOneDefinition,
      oneOnOneSettings,
    );
    if (!judged.ok) throw new Error('The judged revision did not compile');
    const roomId = await f.room(host.actorId, 'one-on-one', {
      format_version: 2,
      config: validConfig,
      execution_plan: {
        preRoundPrep: { enabled: false },
        resolutionDraw: { enabled: false },
      },
      rules_snapshot: judged.rules,
      status: 'ready',
      competition_type: 'casual',
    });
    const bot = createId();
    await f.insert('actors', { id: bot, kind: 'bot' });
    await f.insert(
      'bot_profiles',
      {
        actor_id: bot,
        name: 'Fixture bot',
        persona: 'Fixture',
        voice: 'aura-2-thalia-en',
      },
      'actor_id',
    );
    for (const [actorId, role] of [
      [host.actorId, 'affirmative'],
      [guest.actorId, 'negative'],
      [bot, 'judge'],
    ] as const)
      await f.insert('room_participants', {
        id: createId(),
        room_id: roomId,
        actor_id: actorId,
        seat_kind: role === 'judge' ? 'judge' : 'side',
        side: role === 'judge' ? null : role,
        slot: 0,
      });
    const roundId = createId();
    f.track('rounds', roundId);
    try {
      await roomCommandOperations({
        database: drizzle({ client: f.sql }),
        commandTransaction: roomCommandTransaction(f.sql, 2),
        judgeAdmission: createCasualJudgeAdmission({
          nextId: createId,
          policy: {
            decide: betaAllowance().allowance,
            accountEligible: betaAllowance().accountEligible,
          },
        }),
      }).executeRoomCommand({
        caller: host,
        actorId: host.actorId,
        roomId,
        roundId,
        commandId: createId(),
        payloadDigest: 'a'.repeat(64),
        type: 'start-round',
        targetActorId: null,
        seatsBotDebater: () => false,
        formatTuple: null,
        authorizeRead: (state, account) =>
          account?.member === true && state.hostActorId === host.actorId,
        readyAgreements: () => null,
        prepare: async () => (state) => ({
          ok: true,
          mutation: {
            state: {
              ...state,
              status: 'started',
              roundRef: { id: roundId, status: 'active' },
              version: state.version + 1,
              changeVersion: state.changeVersion + 1,
            },
            freeze: true,
            seatsBotDebater: false,
            consent: null,
            publishDefinition: false,
            draw: null,
            seatDraw: null,
            roundSeed: null,
            members: [host.actorId],
          },
        }),
      });
      assert({
        given: 'a Start with no prep and no topic draw, and a bot judge',
        should: 'tell both seated humans their Round has started, and no bot',
        actual: await told(f, roundId, 'round_started'),
        expected: [host.userId, guest.userId].sort(),
      });
    } finally {
      await f.sql`delete from outbox where topic=${buildRoomTopic(roomId)}`;
    }
  });
});
