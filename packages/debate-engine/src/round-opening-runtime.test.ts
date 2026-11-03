import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { edges } from './room-assembly.test-support';
import {
  advanceOpening,
  forfeitInOpening,
  inPreRoundPrep,
  strikeInOpening,
} from './round-opening-runtime';
import { SEED, at, drawRoom, opened } from './round-opening.test-support';
import {
  emptyCheckpoint,
  oneOnOneActors,
  oneOnOneRules,
  oneOnOneSeats,
} from './runtime.test-support';

setupRitewayBun();

const PREP_MS = 1_200_000;
const roundFacts = {
  round: {
    id: 'round',
    status: 'opening' as const,
    currentStage: null,
    startedAt: null,
    completedAt: null,
    outcome: null,
  },
  rules: oneOnOneRules(),
  participants: oneOnOneSeats,
  checkpoint: emptyCheckpoint,
  segments: [],
  nextSegmentId: () => 's0000000000000000000001',
};
const hydrated = (
  world: ReturnType<typeof opened>,
  now: string,
  seed: string | null = SEED,
) => ({ ...roundFacts, opening: world.opening, seed, now });

const noDraw = (prepMs: number | null) => ({
  ...roundFacts,
  opening: { startRoundAt: edges.now, draw: null, prepMs },
  seed: null,
});

describe('advanceOpening', () => {
  test('nothing changes while prep has time left', () => {
    assert({
      given: 'a prep-only opening one minute in',
      should: 'stay in the opening and write no draw',
      actual: (() => {
        const projection = advanceOpening({
          ...noDraw(PREP_MS),
          now: at(60),
        });
        return [projection.round?.status, projection.openingEffect];
      })(),
      expected: ['opening', { strikes: null, reveal: null, activatedAt: null }],
    });
  });

  test('a late sweep starts the Round at the instant prep ended', () => {
    const projection = advanceOpening({
      ...noDraw(PREP_MS),
      now: at(1200 + 90),
    });
    assert({
      given: 'a sweep 90 s after prep ended',
      should: 'start the Round at the prep end, not at the sweep',
      actual: [projection.round?.status, projection.openingEffect?.activatedAt],
      expected: ['active', at(1200)],
    });
  });

  test('due strikes ride along so the writer can append them', () => {
    const world = opened(drawRoom(), PREP_MS);
    const projection = advanceOpening(hydrated(world, at(125)));
    assert({
      given: 'two expired strike windows',
      should: 'carry both time-outs and stay in the opening',
      actual: [
        projection.openingEffect?.strikes?.added.length,
        projection.round?.status,
      ],
      expected: [2, 'opening'],
    });
  });
});

describe('strikeInOpening', () => {
  const strikeBy = (actorId: string, ordinal: number, position: number) => ({
    actorId,
    commandId: `strike-${ordinal}`,
    ordinal,
    position,
  });

  test('an accepted strike is carried on the projection', () => {
    const world = opened(drawRoom());
    const projection = strikeInOpening({
      ...hydrated(world, edges.now),
      seats: world.seats,
      strike: strikeBy('other', 0, 2),
    });
    assert({
      given: 'the Negative striking on its turn',
      should: 'append a debater strike',
      actual: projection.openingEffect?.strikes?.added.map((s) => [
        s.position,
        s.kind,
      ]),
      expected: [[2, 'debater']],
    });
  });

  test('a refused strike throws, so nothing is written', () => {
    const world = opened(drawRoom());
    let message = '';
    try {
      strikeInOpening({
        ...hydrated(world, edges.now),
        seats: world.seats,
        strike: strikeBy('host', 0, 2),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert({
      given: 'the Affirmative striking on the Negative turn',
      should: 'refuse not-your-turn',
      actual: message,
      expected: 'not-your-turn',
    });
  });

  test('the last strike with no prep starts the Round', () => {
    const start = opened(drawRoom());
    const moves = [
      strikeBy('other', 0, 0),
      strikeBy('host', 1, 1),
      strikeBy('other', 2, 2),
      strikeBy('host', 3, 3),
    ];
    const last = moves.reduce(
      (world, strike) => {
        const projection = strikeInOpening({
          ...hydrated(world.state, edges.now),
          seats: world.state.seats,
          strike,
        });
        return {
          projection,
          state: {
            ...world.state,
            opening: {
              ...world.state.opening,
              draw: {
                ...world.state.opening.draw!,
                strikes: [
                  ...world.state.opening.draw!.strikes,
                  ...(projection.openingEffect?.strikes?.added ?? []),
                ],
              },
            },
          },
        };
      },
      {
        projection: null as ReturnType<typeof strikeInOpening> | null,
        state: start,
      },
    ).projection!;
    assert({
      given: 'the final strike of a draw with no prep',
      should: 'start the Round at that strike, and reveal once',
      actual: [
        last.round?.status,
        last.openingEffect?.activatedAt,
        last.openingEffect?.strikes?.added.length,
        typeof last.openingEffect?.reveal?.resolution,
      ],
      expected: ['active', edges.now, 1, 'string'],
    });
  });
});

describe('forfeitInOpening', () => {
  test('before the reveal it stands as a result, with no resolution to name', () => {
    const world = opened(drawRoom(), PREP_MS);
    const projection = forfeitInOpening({
      ...hydrated(world, at(5)),
      actorId: oneOnOneActors.affirmative,
    });
    assert({
      given: 'the Affirmative forfeiting before any strike',
      should: 'complete for the Negative and leave the draw unrevealed',
      actual: [
        projection.round?.status,
        projection.round?.outcome,
        projection.openingEffect,
      ],
      expected: [
        'completed',
        'negative',
        { strikes: null, reveal: null, activatedAt: null },
      ],
    });
  });

  test('after prep ended it still counts from the prep end', () => {
    const projection = forfeitInOpening({
      ...noDraw(PREP_MS),
      now: at(1201),
      actorId: oneOnOneActors.negative,
    });
    assert({
      given: 'a forfeit one second after prep ended, before any sweep',
      should: 'record the start at the prep end and the affirmative result',
      actual: [
        projection.openingEffect?.activatedAt,
        projection.round?.status,
        projection.round?.outcome,
      ],
      expected: [at(1200), 'completed', 'affirmative'],
    });
  });
});

test('a forfeit after prep ended invents no played segment, whatever the countdown', () => {
  const rules = oneOnOneRules();
  const projection = forfeitInOpening({
    ...noDraw(PREP_MS),
    rules: { ...rules, countdownMs: 0 },
    now: at(1201),
    actorId: oneOnOneActors.negative,
  });
  assert({
    given: 'a zero countdown and a forfeit before any sweep started the Round',
    should: 'write no segment and no final segment end',
    actual: [
      projection.segmentInserts,
      projection.segmentCloses,
      projection.finalSegmentEndedAt,
      projection.round?.status,
    ],
    expected: [[], [], undefined, 'completed'],
  });
});

test('inPreRoundPrep is true only while prep runs', () => {
  const opening = { startRoundAt: edges.now, draw: null, prepMs: PREP_MS };
  assert({
    given: 'the first minute, the last millisecond and the end of prep',
    should: 'report prep until the instant it ends',
    actual: [
      inPreRoundPrep({ opening, seed: null, now: at(60) }),
      inPreRoundPrep({
        opening,
        seed: null,
        now: new Date(Date.parse(at(1200)) - 1).toISOString(),
      }),
      inPreRoundPrep({ opening, seed: null, now: at(1200) }),
    ],
    expected: [true, true, false],
  });
});
