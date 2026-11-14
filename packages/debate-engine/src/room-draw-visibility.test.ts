import type { RoomAssemblyState } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { projectOpening } from './round-opening';
import { consent, edges } from './room-assembly.test-support';
import { canonicalJson, digestOf } from '@daisy/seeded-random';
import { bytesOf, drawCommitment, inputCommitment } from './draw-random';
import {
  SALT,
  SEED,
  SENTINEL,
  begin,
  command,
  drawRoom,
  drawStart,
  opened,
  seedBytes,
  strike,
} from './round-opening.test-support';

setupRitewayBun();

const judge = {
  id: 'p3',
  actorId: 'judge',
  label: 'Judge',
  kind: 'human' as const,
  role: 'judge' as const,
  slot: 0,
  eligible: true,
  consentVersion: 0,
  consentCommandId: 'r3',
};
const withJudge = (room: RoomAssemblyState): RoomAssemblyState => ({
  ...room,
  participants: [...room.participants, judge],
});

/** Strikes the lowest standing position on each turn until the reveal. */
const reveal = (
  world: ReturnType<typeof opened>,
  strikers: readonly string[],
) =>
  strikers.reduce((current, actorId, ordinal) => {
    const draw = current.opening.draw!;
    const standing = draw.items.find(
      (i) => !draw.strikes.some((s) => s.position === i.position),
    )!;
    const outcome = strike(current, actorId, ordinal, standing.position);
    if (!outcome.ok) throw new Error(outcome.refusal);
    return { ...current, opening: outcome.opening };
  }, world);

const read = (
  world: ReturnType<typeof opened>,
  viewer: string,
  now = edges.now,
) => projectOpening(world.opening, seedBytes, world.seats, viewer, now);

const distinctLines = (json: string, prefix: string) =>
  new Set(json.match(new RegExp(`${prefix}-\\d+`, 'g')) ?? []).size;

describe('who sees which resolution, stage by stage', () => {
  const viewers = ['host', 'other', 'judge', 'watcher'];
  const withJudgeOpened = (room = drawRoom()) => {
    const world = opened(room);
    return { ...world, seats: [...world.seats, judge] };
  };

  test('a host-list draw', () => {
    const assembling = withJudge(drawRoom());
    const striking = withJudgeOpened();
    const revealed = reveal(striking, ['other', 'host', 'other', 'host']);
    const seen = (world: ReturnType<typeof opened>) =>
      viewers.map((viewer) =>
        distinctLines(JSON.stringify(read(world, viewer)), SENTINEL),
      );
    assert({
      given: 'the list author, the Negative, a judge and a spectator',
      should:
        'show the author their list before Start, the debaters the drawn five, and everyone else only the survivor',
      actual: [
        viewers.map((viewer) =>
          distinctLines(
            JSON.stringify(
              projectRoom(
                assembling,
                viewer,
                consent,
                '2026-11-02T12:00:00.000Z',
              ),
            ),
            SENTINEL,
          ),
        ),
        seen(striking),
        seen(revealed),
      ],
      expected: [
        [5, 0, 0, 0],
        [5, 5, 0, 0],
        [5, 5, 1, 1],
      ],
    });
  });

  test('a bank draw hosted from outside the seats', () => {
    const BANK = 'BANK-LINE';
    const bank = {
      revision: 1,
      entries: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        id: `b${n}`,
        text: `${BANK}-${n}`,
        category: 'value' as const,
        locale: 'en',
      })),
    };
    const seated = drawRoom({ kind: 'bank', categories: ['value'] });
    const room = {
      ...seated,
      participants: seated.participants.map((p) =>
        p.actorId === 'host' ? { ...p, actorId: 'aff' } : p,
      ),
    };
    const ready = { available: true, readyActorIds: ['aff', 'other', 'judge'] };
    const started = executeRoomCommand(
      room,
      'host',
      command('start-round', {}, room),
      ready,
      { ...edges, drawStart: { ...drawStart, bank } },
    );
    if (!started.ok) throw new Error(started.refusal);
    const striking = {
      seats: withJudge(room).participants,
      opening: {
        startedAt: edges.now,
        draw: started.mutation.draw!.state,
        prepMs: null,
        stops: [],
      },
    };
    const done = reveal(striking, ['other', 'aff', 'other', 'aff']);
    const seen = (world: ReturnType<typeof opened>) =>
      ['host', 'aff', 'other', 'judge', 'watcher'].map((viewer) =>
        distinctLines(JSON.stringify(read(world, viewer)), BANK),
      );
    assert({
      given: 'a seatless host, both debaters, a judge and a spectator',
      should:
        'give drawn bank lines to the debaters only, and the survivor alone to everyone else',
      actual: [seen(striking), seen(done)],
      expected: [
        [0, 5, 5, 0, 0],
        [1, 5, 5, 1, 1],
      ],
    });
  });

  test('spectators cannot tell one host list from another', () => {
    const striking = withJudgeOpened();
    const other = withJudgeOpened(
      drawRoom({
        kind: 'host',
        resolutions: [1, 2, 3, 4, 5].map((n) => `A different motion ${n}`),
      }),
    );
    assert({
      given: 'two mid-strike openings differing only in the five secret lines',
      should:
        'project byte-identical views to a judge and to a spectator, so no line, order or count leaks',
      actual: ['judge', 'watcher'].map(
        (viewer) =>
          JSON.stringify(read(striking, viewer)) ===
          JSON.stringify(read(other, viewer)),
      ),
      expected: [true, true],
    });
  });
});

describe('the public commitments resist pool enumeration', () => {
  const mutation = begin();
  const draw = mutation.draw!.state;
  const { salt, ...committed } = mutation.draw!.inputs;

  test('the true salt and seed reproduce the commitments', () => {
    assert({
      given: 'the private inputs, salt and seed kept with the draw',
      should: 'reproduce the input commitment and the draw commitment',
      actual: [
        inputCommitment(bytesOf(salt), canonicalJson(committed)) ===
          draw.manifest.inputCommitment,
        drawCommitment({
          roomId: draw.manifest.roomId,
          drawId: draw.id,
          manifestDigest: digestOf(canonicalJson(draw.manifest)),
          seed: bytesOf(SEED),
        }) === draw.commitment,
      ],
      expected: [true, true],
    });
  });

  test('guessing the exact pool without the salt or seed confirms nothing', () => {
    const guesses = ['00'.repeat(32), 'ff'.repeat(32), SEED];
    assert({
      given:
        'an observer who guessed the exact host list but holds neither the salt nor the seed',
      should:
        'match no public commitment with an unsalted digest, a guessed salt or a guessed seed',
      actual: [
        digestOf(canonicalJson(committed)) === draw.manifest.inputCommitment,
        guesses.some(
          (guess) =>
            inputCommitment(bytesOf(guess), canonicalJson(committed)) ===
            draw.manifest.inputCommitment,
        ),
        [SALT, '00'.repeat(32)].some(
          (guess) =>
            drawCommitment({
              roomId: draw.manifest.roomId,
              drawId: draw.id,
              manifestDigest: draw.manifestDigest,
              seed: bytesOf(guess),
            }) === draw.commitment,
        ),
      ],
      expected: [false, false, false],
    });
  });
});

test('the turn reports its time left as of the read (PR #472 review)', () => {
  const world = opened();
  const at = (seconds: number) =>
    new Date(Date.parse(edges.now) + seconds * 1000).toISOString();
  const turn = (now: string, viewer: string) =>
    read(world, viewer, now).view.draw?.turn;
  assert({
    given:
      'a 60 s window read at the start, 13 s later, and 90 s later after a time-out',
    should:
      'project the time left on the current turn from the server clock, for a debater and a spectator alike',
    actual: [
      turn(edges.now, 'host')?.remainingMs,
      turn(at(13), 'host')?.remainingMs,
      turn(at(13), 'watcher')?.remainingMs,
      turn(at(90), 'host')?.remainingMs,
    ],
    expected: [60_000, 47_000, 47_000, 30_000],
  });
});

test('between strikes, no one outside the debaters receives a line, the seed or the salt', () => {
  const botJudge = {
    ...judge,
    id: 'p4',
    actorId: 'bot-judge',
    kind: 'bot' as const,
    slot: 1,
    consentCommandId: null,
  };
  const start = opened(drawRoom());
  const panel = {
    ...start,
    seats: [...start.seats, judge, botJudge],
  };
  const middle = reveal(panel, ['other']);
  const leaked = (viewer: string) => {
    const json = JSON.stringify(read(middle, viewer));
    return [SENTINEL, SEED, SALT].filter((secret) => json.includes(secret));
  };
  assert({
    given:
      'a draw after its first strike, read by a human judge, a bot judge, a spectator and a debater',
    should:
      'deliver no drawn line, seed or salt to anyone outside the debaters, and lines without secrets to a debater',
    actual: {
      judge: leaked('judge'),
      botJudge: leaked('bot-judge'),
      spectator: leaked('watcher'),
      debater: leaked('other'),
    },
    expected: {
      judge: [],
      botJudge: [],
      spectator: [],
      debater: [SENTINEL],
    },
  });
});
