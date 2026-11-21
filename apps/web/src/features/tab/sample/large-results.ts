import type { BracketView } from '@daisy/protocol/lobby/standings-read';
import { sampleId, sampleInstant } from './fixture';
import { largeSurname } from './large-names';

/**
 * Autumn Open's varsity bracket at scale: 64 break to triple octofinals.
 * While elimination rounds run, triple and double octofinals are finished,
 * octofinals are live and the rest wait on them; once certified, every
 * round is decided. Three lower seeds win in triple octofinals.
 */
type OfficialRound = Extract<
  BracketView,
  { visibility: 'official' }
>['tabRounds'][number];
type Tie = OfficialRound['fixtures'][number];

const LARGE_BRACKET = 64;

const roundNames = [
  'Triple octofinals',
  'Double octofinals',
  'Octofinals',
  'Quarterfinals',
  'Semifinals',
  'Final',
] as const;

const starts = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'] as const;

/** The seeds that beat a higher seed in triple octofinals. */
const upsets = new Set([41, 38, 35]);

/** Seeds in bracket order, so 1 meets 64 and the top two meet only in the final. */
const bracketOrder = (size: number): readonly number[] => {
  let order = [1];
  while (order.length < size) {
    const width = order.length * 2;
    order = order.flatMap((seed) => [seed, width + 1 - seed]);
  }
  return order;
};

const side = (seed: number) => {
  const name = largeSurname(seed - 1);
  return {
    entryId: sampleId(`entry${name}`),
    seed,
    shown: { kind: 'name' as const, name },
  };
};

const tieOf = (top: number, bottom: number, state: Tie['state']): Tie => ({
  fixtureId: sampleId(`fixturelargeelim${top}v${bottom}x`),
  entries: [side(top), side(bottom)],
  state,
});

const winnerOf = (top: number, bottom: number, index: number) =>
  index === 0 && upsets.has(bottom) ? bottom : Math.min(top, bottom);

/** Varsity debate's large elimination stage: every round, finished or not. */
function largeBracketRounds(finished: boolean): readonly OfficialRound[] {
  const live = 2;
  let seeds = bracketOrder(LARGE_BRACKET);
  return roundNames.map((name, index) => {
    const status: OfficialRound['status'] =
      finished || index < live
        ? 'complete'
        : index === live
          ? 'running'
          : 'scheduled';
    const pairs = Array.from({ length: seeds.length / 2 }, (_, n) => [
      seeds[2 * n] ?? 1,
      seeds[2 * n + 1] ?? 2,
    ]);
    const ties =
      status === 'scheduled'
        ? []
        : pairs.map(([top = 1, bottom = 2], room) =>
            status === 'complete'
              ? tieOf(top, bottom, {
                  kind: 'decided',
                  resultId: sampleId(`resultlargeelim${top}v${bottom}x`),
                  outcomes: [
                    {
                      entryId: side(top).entryId,
                      won: winnerOf(top, bottom, index) === top,
                      rank: null,
                      ballotsWon:
                        winnerOf(top, bottom, index) === top
                          ? 3 - (room % 2)
                          : 1,
                    },
                    {
                      entryId: side(bottom).entryId,
                      won: winnerOf(top, bottom, index) === bottom,
                      rank: null,
                      ballotsWon:
                        winnerOf(top, bottom, index) === top ? room % 2 : 2,
                    },
                  ],
                })
              : tieOf(top, bottom, {
                  kind: 'live',
                  room: {
                    roomId: sampleId(`roomlargeelim${room + 1}x`),
                    name: `Room ${room + 1}`,
                  },
                  watchable: true,
                }),
          );
    const feeder = roundNames[index - 1];
    seeds = pairs.map(([top = 1, bottom = 2]) => winnerOf(top, bottom, index));
    return {
      tabRoundId: sampleId(`tabroundvarsitylarge${index}`),
      name,
      status,
      startsAt: sampleInstant(starts[index] ?? '16:30'),
      fixtures: ties,
      waitsOn:
        status === 'scheduled' && feeder !== undefined
          ? { feederTabRoundName: feeder, ballotsNeeded: 2, panelSize: 3 }
          : null,
    };
  });
}

/** The ordinary bracket read, grown to 64. */
export function largeBracketView(
  ordinary: BracketView,
  finished: boolean,
): BracketView {
  const tabRounds = [...largeBracketRounds(finished)].map((round) => ({
    ...round,
    fixtures: [...round.fixtures],
  }));
  return ordinary.visibility === 'official'
    ? { ...ordinary, tabRounds }
    : { ...ordinary, tabRounds };
}
