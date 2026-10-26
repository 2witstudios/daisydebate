import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState, RoomCommand } from '@daisy/protocol';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';
import { bytesOf } from './draw-random';
import {
  drawResolutions,
  settleRoom,
  topicInvariantHolds,
} from './resolution-draw';
import { preRoundPhase } from './pre-round-phase';

setupRitewayBun();

const SEED = '01'.repeat(32);
const SALT = '02'.repeat(32);
const SENTINEL = 'SENTINEL-RESOLUTION';
const hostList = [1, 2, 3, 4, 5].map((n) => `${SENTINEL}-${n}`);

const drawConfig = {
  enabled: true as const,
  drawSize: 5,
  strikeWindowMs: 60_000,
  firstStriker: 'negative' as const,
};

/** A casual One-on-one-like Room whose host list draws 5. */
const drawRoom = (
  source:
    | { kind: 'host'; resolutions: string[] }
    | { kind: 'bank'; categories: ('policy' | 'value' | 'fact')[] } = {
    kind: 'host',
    resolutions: hostList,
  },
): RoomAssemblyState => {
  const base = state();
  const resolutionDraw = { ...drawConfig, source };
  return {
    ...base,
    topic: null,
    definition: {
      ...base.definition,
      configurable: {
        ...base.definition.configurable,
        resolutionDraw: {
          drawSize: { min: 3, max: 7 },
          strikeWindowMs: { min: 15_000, max: 180_000 },
          firstStrikers: ['negative', 'affirmative'],
          sources: ['bank', 'host'],
        },
      },
    },
    config: { ...base.config, resolutionDraw },
    executionPlan: { ...base.executionPlan, resolutionDraw },
  };
};

const drawStart = {
  drawId: 'draw00000000000000000001',
  seed: SEED,
  salt: SALT,
  bank: null,
  exclusions: [],
};
const seed = bytesOf(SEED);
const at = (seconds: number) =>
  new Date(Date.parse(edges.now) + seconds * 1000).toISOString();
const command = (
  type: RoomCommand['type'],
  extra: Record<string, unknown> = {},
  room: RoomAssemblyState,
) =>
  ({
    type,
    commandId: `${type}-${extra.ordinal ?? 0}`,
    expectedVersion: room.version,
    ...extra,
  }) as RoomCommand;

const begin = (room = drawRoom()) => {
  const outcome = executeRoomCommand(
    room,
    'host',
    command('start-pre-round', {}, room),
    consent,
    { ...edges, drawStart },
  );
  if (!outcome.ok) throw new Error(outcome.refusal);
  return outcome.mutation;
};

const strike = (
  room: RoomAssemblyState,
  actorId: string,
  ordinal: number,
  position: number,
  now = edges.now,
) =>
  executeRoomCommand(
    room,
    actorId,
    command('strike-resolution', { ordinal, position }, room),
    consent,
    { ...edges, now, drawSeed: seed },
  );

describe('drawResolutions', () => {
  const candidates = ['c', 'a', 'd', 'b', 'e'].map((id) => ({
    id,
    text: id,
    category: null,
  }));

  test('exclusions are dropped, and relaxed only when too few remain', () => {
    const kept = drawResolutions({
      candidates,
      exclusions: ['a'],
      size: 3,
      seed,
    });
    const relaxed = drawResolutions({
      candidates,
      exclusions: ['a', 'b', 'c'],
      size: 3,
      seed,
    });
    assert({
      given: 'one exclusion with enough candidates left',
      should: 'never draw it and not relax',
      actual: kept.ok && [
        kept.items.some((i) => i.candidateId === 'a'),
        kept.exclusionsRelaxed,
        kept.candidateIds,
      ],
      expected: [false, false, ['b', 'c', 'd', 'e']],
    });
    assert({
      given: 'exclusions that leave fewer than the draw size',
      should: 'draw from the full source and say so',
      actual: relaxed.ok && [
        relaxed.exclusionsRelaxed,
        relaxed.candidateIds.length,
      ],
      expected: [true, 5],
    });
  });

  test('a source smaller than the draw, or with duplicate ids, is refused', () => {
    assert({
      given: 'five candidates for a draw of six, then a duplicate id',
      should: 'refuse both',
      actual: [
        drawResolutions({ candidates, exclusions: [], size: 6, seed }).ok,
        drawResolutions({
          candidates: [...candidates, candidates[0]!],
          exclusions: [],
          size: 2,
          seed,
        }).ok,
      ],
      expected: [false, false],
    });
  });
});

describe('start-pre-round', () => {
  test('a draw starts only with a complete, ready, eligible cast', () => {
    const room = drawRoom();
    const run = (overrides: Partial<typeof consent>, r = room) =>
      executeRoomCommand(
        r,
        'host',
        command('start-pre-round', {}, r),
        { ...consent, ...overrides },
        { ...edges, drawStart },
      );
    assert({
      given: 'a debater who is not Ready, and a missing seat',
      should: 'refuse not-ready, then incomplete-cast',
      actual: [
        run({ readyActorIds: ['host'] }),
        run({}, { ...room, participants: room.participants.slice(0, 1) }),
      ],
      expected: [
        { ok: false, refusal: 'not-ready' },
        { ok: false, refusal: 'incomplete-cast' },
      ],
    });
  });

  test('the draw is committed, private inputs ride separately, and the topic stays null', () => {
    const mutation = begin();
    const draw = mutation.state.resolutionDraw!;
    assert({
      given: 'a started host-list draw',
      should:
        'draw five items, keep the topic null and hand over the seed and inputs',
      actual: [
        draw.items.length,
        mutation.state.topic,
        mutation.drawSecrets?.seed,
        mutation.drawSecrets?.inputs.salt,
        mutation.drawSecrets?.inputs.candidateIds.length,
        draw.manifest.source,
      ],
      expected: [5, null, SEED, SALT, 5, { kind: 'host', count: 5 }],
    });
    assert({
      given: 'the public manifest',
      should: 'carry no host text and no unsalted input digest',
      actual: [
        JSON.stringify(draw.manifest).includes(SENTINEL),
        Object.keys(draw.manifest).sort(),
      ],
      expected: [
        false,
        [
          'algorithm',
          'controllers',
          'drawId',
          'drawSize',
          'firstStriker',
          'inputCommitment',
          'roomId',
          'source',
          'strikeWindowMs',
          'version',
        ],
      ],
    });
    assert({
      given: 'the same facts twice',
      should: 'produce the same commitment',
      actual: begin().state.resolutionDraw!.commitment,
      expected: draw.commitment,
    });
  });

  test('a bank draw without its snapshot is unavailable', () => {
    const room = drawRoom({ kind: 'bank', categories: ['value'] });
    assert({
      given: 'a bank source and no loaded bank',
      should: 'refuse draw-unavailable',
      actual: executeRoomCommand(
        room,
        'host',
        command('start-pre-round', {}, room),
        consent,
        { ...edges, drawStart },
      ),
      expected: { ok: false, refusal: 'draw-unavailable' },
    });
  });

  test('a Room with neither a draw nor prep keeps its setup open until Launch', () => {
    const room = state();
    const edited = executeRoomCommand(
      room,
      'host',
      {
        type: 'update-details',
        commandId: 'details',
        expectedVersion: room.version,
        title: 'Renamed',
        topic: 'New motion',
        visibility: 'public',
      },
      consent,
      edges,
    );
    assert({
      given: 'no draw and no prep',
      should:
        'be satisfied, accept edits, refuse start-pre-round and allow Launch',
      actual: [
        preRoundPhase(room, edges.now).phase,
        edited.ok && edited.mutation.state.topic,
        executeRoomCommand(
          room,
          'host',
          command('start-pre-round', {}, room),
          consent,
          edges,
        ),
        projectRoom(room, 'host', consent, edges.now, null).capabilities
          .canStart,
      ],
      expected: [
        'satisfied',
        'New motion',
        { ok: false, refusal: 'prep-unavailable' },
        true,
      ],
    });
  });
});

describe('strikes', () => {
  const started = () => begin().state;

  test('Negative strikes first, then turns alternate', () => {
    const room = started();
    assert({
      given: 'the affirmative trying the first strike',
      should: 'refuse not-your-turn',
      actual: strike(room, 'host', 0, 0),
      expected: { ok: false, refusal: 'not-your-turn' },
    });
    const first = strike(room, 'other', 0, 2);
    assert({
      given: 'the negative striking position 2',
      should: 'record a debater strike and stay unrevealed',
      actual: first.ok && [
        first.mutation.state.resolutionDraw!.strikes.map((s) => [
          s.ordinal,
          s.position,
          s.side,
          s.kind,
        ]),
        first.mutation.state.topic,
        first.mutation.state.version,
      ],
      expected: [[[0, 2, 'negative', 'debater']], null, room.version],
    });
  });

  test('stale ordinals conflict, struck positions are unavailable, spectators are not seated', () => {
    const one = strike(started(), 'other', 0, 2);
    if (!one.ok) throw new Error(one.refusal);
    const room = one.mutation.state;
    assert({
      given: 'a stale form, an already struck position and a non-debater',
      should: 'refuse strike-conflict, strike-unavailable and not-seated',
      actual: [
        strike(room, 'other', 0, 3),
        strike(room, 'host', 1, 2),
        strike(room, 'watcher', 1, 3),
      ],
      expected: [
        { ok: false, refusal: 'strike-conflict' },
        { ok: false, refusal: 'strike-unavailable' },
        { ok: false, refusal: 'not-seated' },
      ],
    });
  });

  test('the final strike reveals the survivor, and its race loser conflicts', () => {
    let room = started();
    const moves: [string, number][] = [
      ['other', 0],
      ['host', 1],
      ['other', 2],
    ];
    moves.forEach(([actor, position], ordinal) => {
      const outcome = strike(room, actor, ordinal, position);
      if (!outcome.ok) throw new Error(outcome.refusal);
      room = outcome.mutation.state;
    });
    const last = strike(room, 'host', 3, 3);
    if (!last.ok) throw new Error(last.refusal);
    const revealedRoom = last.mutation.state;
    const survivor = revealedRoom.resolutionDraw!.items.find(
      (i) => i.position === 4,
    )!;
    assert({
      given: 'the fourth strike of five',
      should: 'make the survivor the topic and satisfy the pre-round (no prep)',
      actual: [
        revealedRoom.topic,
        preRoundPhase(revealedRoom, edges.now).phase,
        topicInvariantHolds(revealedRoom),
      ],
      expected: [survivor.text, 'satisfied', true],
    });
    assert({
      given: 'a second submission for the same final strike',
      should: 'refuse strike-conflict',
      actual: strike(revealedRoom, 'host', 3, 4),
      expected: { ok: false, refusal: 'strike-conflict' },
    });
  });

  test('time-outs strike the lowest standing position at their due instant', () => {
    const room = started();
    const settled = settleRoom(room, seed, at(125));
    assert({
      given: 'two full windows passing with no strike',
      should:
        'record two time-out strikes at the deadlines, lowest standing first',
      actual: settled.resolutionDraw!.strikes.map((s) => [
        s.position,
        s.kind,
        s.at,
      ]),
      expected: [
        [0, 'timeout', at(60)],
        [1, 'timeout', at(120)],
      ],
    });
    assert({
      given: 'settling again at the same instant',
      should: 'add nothing',
      actual: settleRoom(settled, seed, at(125)),
      expected: settled,
    });
  });

  test('a late strike after the deadline meets the settled turn', () => {
    const room = started();
    assert({
      given: 'the negative submitting ordinal 0 exactly at its deadline',
      should: 'refuse strike-conflict: the time-out already took the turn',
      actual: strike(room, 'other', 0, 3, at(60)),
      expected: { ok: false, refusal: 'strike-conflict' },
    });
  });

  test('an all-bot side strikes automatically after three seconds', () => {
    const base = drawRoom();
    const withBot: RoomAssemblyState = {
      ...base,
      participants: base.participants.map((p) =>
        p.role === 'negative' ? { ...p, kind: 'bot' } : p,
      ),
    };
    const room = begin(withBot).state;
    const settled = settleRoom(room, seed, at(3));
    assert({
      given: 'a bot Negative and three seconds',
      should: 'record one automatic strike and open the human turn',
      actual: [
        settled.resolutionDraw!.manifest.controllers,
        settled.resolutionDraw!.strikes.map((s) => [s.kind, s.at]),
      ],
      expected: [
        { affirmative: 'human', negative: 'automatic' },
        [['automatic', at(3)]],
      ],
    });
  });

  test('edits are frozen once the draw has begun', () => {
    const room = started();
    assert({
      given: 'a details edit during the strike',
      should: 'refuse prep-running',
      actual: executeRoomCommand(
        room,
        'host',
        {
          type: 'update-details',
          commandId: 'late-edit',
          expectedVersion: room.version,
          title: 'Late',
          visibility: 'public',
        },
        consent,
        { ...edges, drawSeed: seed },
      ),
      expected: { ok: false, refusal: 'prep-running' },
    });
  });
});

describe('projection', () => {
  const room = begin().state;
  const json = (viewer: string) =>
    JSON.stringify(projectRoom(room, viewer, consent, edges.now, seed));

  test('only debaters see drawn texts', () => {
    const spectator = projectRoom(room, 'watcher', consent, edges.now, seed);
    assert({
      given: 'a spectator during the strike',
      should: 'see progress only, with no drawn or listed text anywhere',
      actual: [
        spectator.resolutionDraw?.visibility,
        json('watcher').includes(SENTINEL),
        spectator.config.resolutionDraw,
      ],
      expected: [
        'progress',
        false,
        { ...drawConfig, source: { kind: 'host', count: 5 } },
      ],
    });
    assert({
      given: 'the Negative debater',
      should: 'see all five texts and may strike',
      actual: [
        projectRoom(room, 'other', consent, edges.now, seed).resolutionDraw
          ?.visibility,
        projectRoom(room, 'other', consent, edges.now, seed).capabilities
          .canStrike,
      ],
      expected: ['debater', true],
    });
  });

  test('the list author sees their own list while assembling', () => {
    const setup = drawRoom();
    assert({
      given: 'the host before the draw, and a spectator',
      should: 'give only the host the authored list',
      actual: [
        projectRoom(setup, 'host', consent, edges.now, null).authoredDrawSource
          ?.resolutions.length,
        projectRoom(setup, 'watcher', consent, edges.now, null)
          .authoredDrawSource,
      ],
      expected: [5, null],
    });
  });
});

describe('topic rules', () => {
  test('turning a draw off needs replacement text in the same command', () => {
    const room = drawRoom();
    const off = { ...room.config, resolutionDraw: { enabled: false as const } };
    const run = (topic?: string | null) =>
      executeRoomCommand(
        room,
        'host',
        {
          type: 'update-config',
          commandId: `off-${String(topic)}`,
          expectedVersion: room.version,
          config: off,
          ...(topic === undefined ? {} : { topic }),
        },
        consent,
        edges,
      );
    const accepted = run('A fixed motion');
    assert({
      given: 'disabling the draw without, then with, a topic',
      should: 'refuse, then accept with that topic',
      actual: [run(), accepted.ok && accepted.mutation.state.topic],
      expected: [{ ok: false, refusal: 'illegal-config' }, 'A fixed motion'],
    });
  });
});
