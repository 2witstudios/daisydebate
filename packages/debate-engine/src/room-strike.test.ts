import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState } from '@daisy/protocol';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { consent, edges } from './room-assembly.test-support';
import { settleRoom, topicInvariantHolds } from './resolution-draw';
import { preRoundPhase } from './pre-round-phase';
import {
  SENTINEL,
  drawConfig,
  drawRoom,
  SEED,
  at,
  begin,
  strike,
} from './room-pre-round.test-support';

setupRitewayBun();

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
    const settled = settleRoom(room, SEED, at(125));
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
      actual: settleRoom(settled, SEED, at(125)),
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
    const settled = settleRoom(room, SEED, at(3));
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
        { ...edges, drawSeed: SEED },
      ),
      expected: { ok: false, refusal: 'prep-running' },
    });
  });
});

describe('projection', () => {
  const room = begin().state;
  const json = (viewer: string) =>
    JSON.stringify(projectRoom(room, viewer, consent, edges.now, SEED));

  test('only debaters see drawn texts', () => {
    const spectator = projectRoom(room, 'watcher', consent, edges.now, SEED);
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
        projectRoom(room, 'other', consent, edges.now, SEED).resolutionDraw
          ?.visibility,
        projectRoom(room, 'other', consent, edges.now, SEED).capabilities
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
