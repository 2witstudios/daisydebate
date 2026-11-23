import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomCreate } from '@daisy/protocol/room-contract';
import type { SeatRef } from '@daisy/protocol/seats';
import {
  requireBotDebateReleased,
  seatsBotDebater,
} from './bot-debate-release';
import type { Store } from './operations';
import {
  account,
  caller,
  makeOperations,
  now,
  state,
} from './operations.test-support';

setupRitewayBun();

const negative = { kind: 'side', side: 'negative', slot: 0 } as const;
const judge = { kind: 'judge', slot: 0 } as const;
const botId = 'b4n6p8r2t4v6x8z1k3b5c7d9';
const judgeId = 'j5n6p8r2t4v6x8z1k3b5c7d9';
const botDebater = {
  actorId: botId,
  kind: 'bot' as const,
  label: 'Practice bot',
  eligible: true,
  aiRole: 'debater' as const,
  ageBand: null,
};
const aiJudge = { ...botDebater, actorId: judgeId, aiRole: 'judge' as const };

/** The refusal a call throws, or 'allowed'. */
const reasonOf = (run: () => unknown): string => {
  try {
    run();
    return 'allowed';
  } catch (error) {
    return (error as { reason?: string }).reason ?? 'error';
  }
};

test('only a bot in a debating seat is a bot debate', () => {
  assert({
    given: 'a bot at negative, a bot judge, a person at negative and no target',
    should: 'name only the bot at negative a bot debater',
    actual: [
      seatsBotDebater(botDebater, negative),
      seatsBotDebater(aiJudge, judge),
      seatsBotDebater({ kind: 'human' }, negative),
      seatsBotDebater(null, negative),
    ],
    expected: [true, false, false, false],
  });
});

test('unreleased bot debates refuse a bot debater whatever else holds', () => {
  const seat = (target: typeof botDebater | null, at: SeatRef, open: boolean) =>
    reasonOf(() => requireBotDebateReleased(target, at, open));
  assert({
    given:
      'bot debates unreleased and released, for a bot debater and an AI judge',
    should:
      'refuse only the unreleased bot debater, coming soon, and leave the AI judge alone',
    actual: [
      seat(botDebater, negative, false),
      seat(aiJudge, judge, false),
      seat(botDebater, negative, true),
    ],
    expected: ['bot-debates-coming-soon', 'allowed', 'allowed'],
  });
});

const createBody = (cast: RoomCreate['cast']): RoomCreate => ({
  commandId: 'c9n6p8r2t4v6x8z1k3b5c7d9',
  title: 'Practice vs Practice bot',
  resolution: { kind: 'strike' },
  visibility: 'public',
  selection: {
    kind: 'catalog',
    formatId: 'freestyle',
    formatVersion: 1,
    presetVersion: 1,
    competitionType: 'casual',
  },
  cast,
});

test('a create casting a bot debater refuses while bot debates are unreleased', async () => {
  const seatedBy = async (released: boolean) => {
    const run = makeOperations({}, true, released);
    await run.operations
      .create(caller, createBody([{ actorId: botId, seat: negative }]))
      .catch(() => null);
    const cast = run.createInput()?.cast;
    const seat = cast?.seats[0];
    return reasonOf(() => {
      const outcome =
        seat &&
        cast?.apply(
          { ...state, participants: [] },
          seat,
          botDebater,
          now,
          false,
        );
      if (outcome && !outcome.ok) throw { reason: outcome.refusal };
    });
  };
  const judged = makeOperations({}, true, false);
  await judged.operations
    .create(caller, createBody([{ actorId: judgeId, seat: judge }]))
    .catch(() => null);
  const judgeCast = judged.createInput()?.cast;
  const judgeSeat = judgeCast?.seats[0];
  const judgeOutcome = reasonOf(() => {
    const outcome =
      judgeSeat &&
      judgeCast?.apply(
        {
          ...state,
          participants: [],
          competitionType: 'casual',
          rules: { ...state.rules, seats: { ...state.rules.seats, judges: 1 } },
        },
        judgeSeat,
        aiJudge,
        now,
        true,
      );
    if (outcome && !outcome.ok) throw { reason: outcome.refusal };
  });
  assert({
    given:
      'a direct create casting a bot debater, unreleased then released, and an AI judge unreleased',
    should:
      'refuse the unreleased bot debater coming soon inside the create, seat the released one, and seat the AI judge',
    actual: [await seatedBy(false), await seatedBy(true), judgeOutcome],
    expected: ['bot-debates-coming-soon', 'allowed', 'allowed'],
  });
});

test('assign-seat of a bot debater refuses while bot debates are unreleased', async () => {
  const seatBot = async (
    released: boolean,
    target = botDebater,
    at: SeatRef = negative,
  ) => {
    const executeRoomCommand: Store['executeRoomCommand'] = async (input) => {
      const decide = await input.prepare(state, now, account, null);
      const outcome = decide(
        state,
        now,
        target as never,
        account,
        null as never,
        null,
        [],
        null,
        true,
        null,
      );
      if (!outcome.ok) throw { reason: outcome.refusal };
      return { kind: 'applied' } as never;
    };
    const { operations } = makeOperations(
      { executeRoomCommand },
      true,
      released,
    );
    return operations
      .command(caller, state.id, {
        type: 'assign-seat',
        commandId: 'd9n6p8r2t4v6x8z1k3b5c7d9',
        expectedVersion: state.version,
        actorId: target.actorId,
        seat: at,
      })
      .then(
        () => 'allowed',
        (error: unknown) => (error as { reason?: string }).reason ?? 'error',
      );
  };
  const unreleased = await seatBot(false);
  const released = await seatBot(true);
  assert({
    given: 'the host assigning a bot debater with bot debates unreleased',
    should: 'refuse coming soon before the seat changes',
    actual: unreleased,
    expected: 'bot-debates-coming-soon',
  });
  assert({
    given: 'the same assignment with bot debates released',
    should: 'not refuse it for release',
    actual: released === 'bot-debates-coming-soon',
    expected: false,
  });
});

test('cast choices offer no bot debater while bot debates are unreleased, and keep the AI judge', async () => {
  const listRoomBots: Store['listRoomBots'] = async () =>
    [
      {
        id: botId,
        actorId: botId,
        kind: 'bot',
        label: 'Practice bot',
        eligible: true,
        aiRole: 'debater',
        voice: 'neutral',
      },
      {
        id: judgeId,
        actorId: judgeId,
        kind: 'bot',
        label: 'AI judge',
        eligible: true,
        aiRole: 'judge',
        voice: 'neutral',
      },
    ] as never;
  const offered = async (released: boolean) =>
    (
      await makeOperations(
        { listRoomBots },
        true,
        released,
      ).operations.castChoices(caller)
    ).map((choice) => choice.aiRole);
  assert({
    given: 'a roster of a bot debater and the AI judge',
    should: 'offer only the AI judge unreleased, and both released',
    actual: [await offered(false), await offered(true)],
    expected: [['judge'], ['debater', 'judge']],
  });
});
