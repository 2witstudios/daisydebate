import type { RoomAssemblyState } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { executeRoomCommand, projectRoom } from './room-assembly';
import { consent, edges } from './room-assembly.test-support';
import {
  bytesOf,
  canonicalJson,
  digestOf,
  drawCommitment,
  inputCommitment,
} from './draw-random';
import {
  SALT,
  SEED,
  SENTINEL,
  begin,
  command,
  drawRoom,
  drawStart,
  strike,
} from './room-pre-round.test-support';

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
const reveal = (room: RoomAssemblyState, strikers: readonly string[]) =>
  strikers.reduce((current, actorId, ordinal) => {
    const draw = current.resolutionDraw!;
    const standing = draw.items.find(
      (i) => !draw.strikes.some((s) => s.position === i.position),
    )!;
    const outcome = strike(current, actorId, ordinal, standing.position);
    if (!outcome.ok) throw new Error(outcome.refusal);
    return outcome.mutation.state;
  }, room);

/** How many distinct drawn or listed lines a viewer's JSON carries. */
const linesSeen = (
  room: RoomAssemblyState,
  viewer: string,
  prefix: string,
  ready = consent,
) =>
  new Set(
    JSON.stringify(projectRoom(room, viewer, ready, edges.now, SEED)).match(
      new RegExp(`${prefix}-\\d+`, 'g'),
    ) ?? [],
  ).size;

describe('who sees which resolution, stage by stage', () => {
  const viewers = ['host', 'other', 'judge', 'watcher'];
  const assembling = withJudge(drawRoom());
  const striking = withJudge(begin().state);
  const revealed = reveal(striking, ['other', 'host', 'other', 'host']);

  test('a host-list draw', () => {
    assert({
      given:
        'the list-author Affirmative, the Negative, a judge and a spectator before, during and after the strike',
      should:
        'show the author their list, debaters the drawn five, and everyone else only the survivor once revealed',
      actual: [assembling, striking, revealed].map((room) =>
        viewers.map((viewer) => linesSeen(room, viewer, SENTINEL)),
      ),
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
      command('start-pre-round', {}, room),
      ready,
      { ...edges, drawStart: { ...drawStart, bank } },
    );
    if (!started.ok) throw new Error(started.refusal);
    const striking = withJudge(started.mutation.state);
    const done = reveal(striking, ['other', 'aff', 'other', 'aff']);
    const seen = (state: RoomAssemblyState) =>
      ['host', 'aff', 'other', 'judge', 'watcher'].map((viewer) =>
        linesSeen(state, viewer, BANK, ready),
      );
    assert({
      given:
        'a seatless host, both debaters, a judge and a spectator during and after the strike',
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
    const other = withJudge(
      begin(
        drawRoom({
          kind: 'host',
          resolutions: [1, 2, 3, 4, 5].map((n) => `A different motion ${n}`),
        }),
      ).state,
    );
    const view = (room: RoomAssemblyState, viewer: string) => {
      const projected = projectRoom(room, viewer, consent, edges.now, SEED);
      return JSON.stringify({ ...projected, authoredDrawSource: null });
    };
    assert({
      given:
        'two mid-strike Rooms identical except for the five secret host lines',
      should:
        'project byte-identical views to a judge and to a spectator, so no line, order or position leaks',
      actual: [
        view(striking, 'judge') === view(other, 'judge'),
        view(striking, 'watcher') === view(other, 'watcher'),
      ],
      expected: [true, true],
    });
  });
});

describe('the public commitments resist pool enumeration', () => {
  const mutation = begin();
  const draw = mutation.state.resolutionDraw!;
  const { salt, ...committed } = mutation.drawSecrets!.inputs;

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
  const striking = begin().state;
  const at = (seconds: number) =>
    new Date(Date.parse(edges.now) + seconds * 1000).toISOString();
  const turnOf = (now: string, viewer: string) =>
    projectRoom(striking, viewer, consent, now, SEED).resolutionDraw?.turn;
  assert({
    given:
      'a 60 s window read at the start, 13 s later, and 90 s later after a time-out',
    should:
      'project the time left on the current turn from the server clock, for a debater and a spectator alike',
    actual: [
      turnOf(edges.now, 'host')?.remainingMs,
      turnOf(at(13), 'host')?.remainingMs,
      turnOf(at(13), 'watcher')?.remainingMs,
      turnOf(at(90), 'host')?.remainingMs,
    ],
    expected: [60_000, 47_000, 47_000, 30_000],
  });
});

test('between strikes, no one outside the debaters receives a line, the seed or the salt (PR #472 review)', () => {
  const botJudge = {
    ...judge,
    id: 'p4',
    actorId: 'bot-judge',
    kind: 'bot' as const,
    slot: 1,
    consentCommandId: null,
  };
  const panel: RoomAssemblyState = {
    ...withJudge(begin().state),
    participants: [...withJudge(begin().state).participants, botJudge],
  };
  // One strike in: the draw is mid-way, with more turns to come.
  const once = strike(
    panel,
    'other',
    0,
    panel.resolutionDraw!.items[0]!.position,
  );
  if (!once.ok) throw new Error(once.refusal);
  const middle = once.mutation.state;
  const leaked = (viewer: string) => {
    const json = JSON.stringify(
      projectRoom(middle, viewer, consent, edges.now, SEED),
    );
    return [SENTINEL, SEED, SALT].filter((secret) => json.includes(secret));
  };
  assert({
    given:
      'a draw after its first strike, read by a human judge, a bot judge, a spectator and a debater',
    should:
      'deliver no drawn line, seed or salt to anyone outside the debaters, and lines but never the seed or salt to a debater',
    actual: {
      judge: leaked('judge'),
      botJudge: leaked('bot-judge'),
      spectator: leaked('watcher'),
      debater: leaked('other'),
      strikes: middle.resolutionDraw!.strikes.length,
    },
    expected: {
      judge: [],
      botJudge: [],
      spectator: [],
      debater: [SENTINEL],
      strikes: 1,
    },
  });
});

test('a Room closed mid-strike shows no turn to count down (PR #472 review)', () => {
  const closed: RoomAssemblyState = { ...begin().state, status: 'abandoned' };
  assert({
    given: 'a Room the host closed while the debaters were striking',
    should: 'project no open turn, so no viewer waits on a deadline',
    actual: projectRoom(closed, 'host', consent, edges.now, SEED).resolutionDraw
      ?.turn,
    expected: null,
  });
});
