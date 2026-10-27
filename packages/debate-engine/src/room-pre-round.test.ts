import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';
import { drawResolutions } from './resolution-draw';
import { preRoundPhase } from './pre-round-phase';
import {
  SEED,
  SALT,
  SENTINEL,
  drawRoom,
  drawStart,
  seedBytes,
  command,
  begin,
} from './room-pre-round.test-support';

setupRitewayBun();

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
      seed: seedBytes,
    });
    const relaxed = drawResolutions({
      candidates,
      exclusions: ['a', 'b', 'c'],
      size: 3,
      seed: seedBytes,
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
        drawResolutions({
          candidates,
          exclusions: [],
          size: 6,
          seed: seedBytes,
        }).ok,
        drawResolutions({
          candidates: [...candidates, candidates[0]!],
          exclusions: [],
          size: 2,
          seed: seedBytes,
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

  test('a bank draw takes only English entries of the chosen categories', () => {
    const room = drawRoom({ kind: 'bank', categories: ['value', 'policy'] });
    const entry = (
      id: string,
      category: 'policy' | 'value' | 'fact',
      locale = 'en',
    ) => ({ id, text: `${SENTINEL} ${id}`, category, locale });
    const bank = {
      revision: 3,
      entries: [
        ...['v1', 'v2', 'v3'].map((id) => entry(id, 'value')),
        ...['p1', 'p2', 'p3'].map((id) => entry(id, 'policy')),
        entry('f1', 'fact'),
        entry('v4', 'value', 'fr'),
      ],
    };
    const outcome = executeRoomCommand(
      room,
      'host',
      command('start-pre-round', {}, room),
      consent,
      { ...edges, drawStart: { ...drawStart, bank } },
    );
    const inputs = outcome.ok ? outcome.mutation.drawSecrets?.inputs : null;
    assert({
      given:
        'a value-and-policy bank draw over a mixed-locale, three-category bank',
      should:
        'draw five from the six English value and policy entries and record the bank selection',
      actual: outcome.ok && [
        [...(inputs?.candidateIds ?? [])].sort(),
        outcome.mutation.state.resolutionDraw!.items.every(
          (item) => item.category !== 'fact',
        ),
        inputs?.sourceInput,
      ],
      expected: [
        ['p1', 'p2', 'p3', 'v1', 'v2', 'v3'],
        true,
        {
          kind: 'bank',
          revision: 3,
          categories: ['policy', 'value'],
          locale: 'en',
          difficulties: ['advanced', 'intro', 'standard'],
        },
      ],
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

test('the draw button shows only when the draw would start (PR #472 review)', () => {
  const room = drawRoom();
  const can = (ready: { available: boolean; readyActorIds: string[] }) =>
    projectRoom(room, 'host', ready, edges.now, null).capabilities
      .canStartPreRound;
  assert({
    given:
      'a full draw Room with everyone Ready, one debater not Ready, and Ready unreadable',
    should: 'offer the draw only when the draw gate would let it start',
    actual: [
      can(consent),
      can({ available: true, readyActorIds: ['host'] }),
      can({ available: false, readyActorIds: [] }),
    ],
    expected: [true, false, false],
  });
});
