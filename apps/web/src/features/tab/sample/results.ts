import type { EventResultsView } from '@daisy/protocol/lobby/results-read';
import type { BracketView } from '@daisy/protocol/lobby/standings-read';
import { bracketOf, type Bracket } from '../results';
import type { WallClock } from '../tab-round';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import type { SampleScene } from './scene';
import { sampleId, sampleInstant, sampleWallClock } from './tab-round';

/** An official's tab round; every audience's may be no more than this. */
type OfficialRound = Extract<BracketView, { visibility: 'official' }>['tabRounds'][number];
type Tie = OfficialRound['ties'][number];
type Side = Tie['top'];

const side = (seed: number, name: string): Side => ({
  entryId: sampleId(`entry${name}`),
  seed,
  name,
});

/** A decided fixture, by the ballots each side won. */
const decided = (
  top: Side,
  topBallots: number,
  bottom: Side,
  bottomBallots: number,
): Tie => ({
  fixtureId: sampleId(`fixture${top.name}${bottom.name}`),
  top,
  bottom,
  state: { kind: 'decided', topBallots, bottomBallots },
});

const live = (top: Side, bottom: Side, room: string): Tie => ({
  fixtureId: sampleId(`fixture${top.name}${bottom.name}`),
  top,
  bottom,
  state: {
    kind: 'live',
    room: { roomId: sampleId(`room${room}`), name: room },
    watchable: true,
  },
});

const tabRound = (
  name: string,
  status: 'complete' | 'running' | 'scheduled',
  ties: readonly Tie[],
  more: Partial<{ startsAt: string; waitsOn: OfficialRound['waitsOn'] }> = {},
): OfficialRound => ({
  tabRoundId: sampleId(`tabroundvarsity${name}`),
  name,
  status,
  startsAt: more.startsAt ?? null,
  ties: [...ties],
  waitsOn: more.waitsOn ?? null,
});

/** Varsity debate's elimination stage, once the break is announced. */
export function sampleBracketView(
  slug: string,
  event: string | null,
  scene: SampleScene,
): { readonly read: BracketView; readonly wallClock: WallClock } | null {
  if (slug !== AUTUMN || (event !== null && event !== VARSITY)) return null;
  if (!reached(scene, 'elims')) return null;
  const finished = reached(scene, 'finished');
  const tabRounds = [
    tabRound('Quarterfinals', 'complete', [
      decided(side(1, 'Jensen'), 3, side(8, 'Sato'), 0),
      decided(side(4, 'Amari'), 1, side(5, 'Doyle'), 2),
      decided(side(2, 'Castillo'), 3, side(7, 'Wu'), 0),
      decided(side(3, 'Okafor'), 2, side(6, 'Haddad'), 1),
    ]),
    finished
      ? tabRound('Semifinals', 'complete', [
          decided(side(1, 'Jensen'), 2, side(5, 'Doyle'), 1),
          decided(side(2, 'Castillo'), 1, side(3, 'Okafor'), 2),
        ])
      : tabRound('Semifinals', 'running', [
          live(side(1, 'Jensen'), side(5, 'Doyle'), 'Room 1'),
          live(side(2, 'Castillo'), side(3, 'Okafor'), 'Room 2'),
        ]),
    finished
      ? tabRound('Final', 'complete', [
          decided(side(1, 'Jensen'), 4, side(3, 'Okafor'), 1),
        ])
      : tabRound('Final', 'scheduled', [], {
          startsAt: sampleInstant('18:30'),
          waitsOn: {
            feederTabRoundName: 'Semifinals',
            ballotsNeeded: 3,
            panelSize: 5,
          },
        }),
  ];
  const shape = {
    lobbyId: sampleId('autumnopen'),
    eventId: sampleId('eventvarsity'),
    stageId: sampleId('stagevarsityelims'),
    division: null,
  };
  return {
    read:
      scene.viewer === 'host'
        ? { ...shape, visibility: 'official', tabRounds }
        : { ...shape, visibility: 'audience', tabRounds },
    wallClock: sampleWallClock,
  };
}

/** The bracket as a screen draws it, for the sample screens that embed one. */
export function sampleBracket(
  slug: string,
  event: string | null,
  scene: SampleScene,
): Bracket | null {
  const sample = sampleBracketView(slug, event, scene);
  return sample === null ? null : bracketOf(sample.read, sample.wallClock);
}

const opened = (cause: 'round_close' | 'prelims_end' | 'break', time: string) => ({
  kind: 'open' as const,
  cause,
  openedAt: sampleInstant(time),
});

/** Autumn Open's results for its host, once elimination rounds have begun. */
export function sampleEventResultsView(
  slug: string,
  scene: SampleScene,
): {
  readonly read: EventResultsView;
  readonly bracket: BracketView;
  readonly wallClock: WallClock;
} | null {
  const bracket = sampleBracketView(slug, null, scene);
  if (bracket === null) return null;
  const finished = reached(scene, 'finished');
  const abara = { actorId: sampleId('actordanaabara'), name: 'D. Abara' };
  return {
    read: {
      lobbyId: sampleId('autumnopen'),
      eventId: sampleId('eventvarsity'),
      prelimsCertifiedAt: sampleInstant('16:52'),
      certification: finished
        ? { kind: 'certified', certifiedAt: sampleInstant('19:40') }
        : {
            kind: 'blocked',
            running: ['Semifinals', 'Final'].map((name) => ({
              tabRoundId: sampleId(`tabroundvarsity${name}`),
              name,
            })),
          },
      audiences: [
        {
          audience: 'responsible_adults',
          openings: (['decision', 'scores', 'reason', 'feedback'] as const).map(
            (part) => ({ part, state: opened('round_close', '15:10') }),
          ),
        },
        {
          audience: 'competitors',
          openings: [
            { part: 'decision', state: opened('round_close', '15:10') },
            ...(['scores', 'feedback'] as const).map((part) => ({
              part,
              state: finished
                ? opened('prelims_end', '16:52')
                : { kind: 'openable' as const },
            })),
          ],
        },
        {
          audience: 'public',
          openings: [{ part: 'decision', state: opened('break', '17:05') }],
        },
      ],
      corrections: [
        {
          resultId: sampleId('resultreidnakata2b'),
          supersedesResultId: sampleId('resultreidnakata2a'),
          tabRoundNumber: 2,
          fixture: {
            fixtureId: sampleId('fixturereidnakata2'),
            entries: ['Reid', 'Nakata'].map((name) => ({
              entryId: sampleId(`entry${name}`),
              name,
            })),
          },
          changed: 'winner',
          recordedBy: abara,
          confirmedBy: {
            actorId: sampleId('actorhost'),
            name: 'Sam Rivera',
            viewer: true,
          },
          recordedAt: sampleInstant('17:20'),
          usedByPublishedDraws: [
            { drawId: sampleId('drawvarsity3v1'), tabRoundNumber: 3 },
          ],
        },
      ],
      sanction: {
        organizationName: LEAGUE_NAME,
        sentAt: finished ? sampleInstant('19:40') : null,
      },
      capabilities: { release: true, certify: true },
      ballotAccess: 'unreleased',
      screeningHolds: {
        count: 2,
        summary:
          "A phone number was removed from one. One is flagged for language. The judge's original is kept.",
      },
    },
    bracket: bracket.read,
    wallClock: sampleWallClock,
  };
}
