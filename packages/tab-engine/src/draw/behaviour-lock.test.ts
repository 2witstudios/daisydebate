import { canonicalJson, digestOf } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Draw, DrawInput } from '../shapes/draw';
import { breaks, BREAKS_VERSION } from '../breaks/breaks';
import { ladderInput, LADDER_INPUT_VERSION } from '../season/ladder-input';
import { seasonStandings, SEASON_VERSION } from '../season/season-standings';
import {
  randomPreset,
  roundRobinPreset,
  swissPower,
} from '../simulate/presets';
import { standings, STANDINGS_VERSION } from '../standings/standings';
import { draw } from './index';
import {
  drawsOf,
  fixturesOf,
  entries,
  fourSides,
  judges,
  playTwoSided,
  request,
  seedOf,
  speakers,
  twoSides,
  withSettings,
} from './draw.test-support';

setupRitewayBun();

/**
 * The behaviour lock: a corpus of draw inputs with the digest of each output
 * and the method versions that made it. A digest that changes while its
 * versions stay the same is a change of behaviour nobody declared, and fails
 * until the version literal is raised on purpose. A raised version makes the
 * entry stale: refresh it from the failure message.
 */
type LockEntry = {
  readonly versions: Readonly<Record<string, string>>;
  readonly digest: string;
};
type LockVerdict =
  | { readonly kind: 'held' }
  | { readonly kind: 'raised' }
  | {
      readonly kind: 'broken';
      readonly expected: string;
      readonly actual: string;
    };

const lockVerdict = (
  locked: LockEntry | undefined,
  current: LockEntry,
): LockVerdict => {
  if (locked === undefined)
    return {
      kind: 'broken',
      expected: 'nothing locked',
      actual: current.digest,
    };
  if (canonicalJson(locked.versions) !== canonicalJson(current.versions))
    return { kind: 'raised' };
  return locked.digest === current.digest
    ? { kind: 'held' }
    : { kind: 'broken', expected: locked.digest, actual: current.digest };
};

const first = drawsOf(
  draw({
    call: 'slot',
    slot: 's',
    events: [request(twoSides, { entries: entries(11, 4) })],
    judges: null,
    commitments: [],
    seed: seedOf(1),
  }),
)[0]!;
const corpus: Record<string, DrawInput> = {
  'two-sided first round': {
    call: 'slot',
    slot: 's',
    events: [request(twoSides, { entries: entries(11, 4) })],
    judges: judges(8),
    commitments: [],
    seed: seedOf(1),
  },
  'two-sided powered round': {
    call: 'slot',
    slot: 's',
    events: [
      request(twoSides, {
        entries: entries(11, 4),
        tabRound: 2,
        history: playTwoSided({ fixtures: [], results: [] }, first, 1),
        cutoff: 1,
      }),
    ],
    judges: judges(8),
    commitments: [],
    seed: seedOf(2),
  },
  'round robin': {
    call: 'windowed',
    event: request(twoSides, {
      entries: entries(7),
      settings: roundRobinPreset,
      tabRound: 3,
    }),
    judges: null,
    seed: seedOf(3),
  },
  'four sides': {
    call: 'windowed',
    event: request(fourSides, {
      entries: entries(12),
      settings: withSettings({ 'pairing.rematch': { force: 'off' } }),
    }),
    judges: null,
    seed: seedOf(4),
  },
  sections: {
    call: 'windowed',
    event: request(speakers, { entries: entries(17, 5) }),
    judges: judges(4),
    seed: seedOf(5),
  },
  elimination: {
    call: 'windowed',
    event: request(twoSides, {
      entries: entries(13),
      stage: {
        kind: 'elimination',
        division: null,
        bracket: { seeds: entries(13).map((e) => e.id) },
      },
    }),
    judges: null,
    seed: seedOf(6),
  },
};

/** A later tab round of a windowed event, after one drawn and unplayed round. */
const secondRound = (input: DrawInput & { call: 'windowed' }): DrawInput => {
  const d = drawsOf(draw(input))[0]!;
  return {
    ...input,
    event: {
      ...input.event,
      tabRound: 2,
      history: {
        fixtures: fixturesOf(d).map((fixture, i) => ({
          id: `lock-${i}`,
          tabRound: 1,
          fixture: fixture as never,
        })),
        results: [],
      },
    } as typeof input.event,
  };
};
corpus['prematched second round'] = secondRound({
  call: 'windowed',
  event: request(twoSides, { entries: entries(10), settings: randomPreset }),
  judges: null,
  seed: seedOf(7),
});
corpus['four sides second round'] = secondRound(
  corpus['four sides'] as DrawInput & { call: 'windowed' },
);
corpus['sections second round'] = secondRound(
  corpus.sections as DrawInput & { call: 'windowed' },
);

const current = (input: DrawInput): LockEntry => {
  const d: Draw = drawsOf(draw(input))[0]!;
  return { versions: d.inputs.engine, digest: digestOf(canonicalJson(d)) };
};

const field = entries(11, 4);
const played = playTwoSided({ fixtures: [], results: [] }, first, 1);
const fold = {
  format: twoSides,
  entries: field,
  history: played,
  settings: swissPower,
  cutoff: 1,
  ratings: null,
  division: null,
  seed: seedOf(8),
} as const;
const pairings = played.fixtures.flatMap((f) =>
  f.fixture.kind === 'pairing' ? [{ id: f.id, fixture: f.fixture }] : [],
);
/** Each fold's output under its own version literal. */
const folds: Record<string, LockEntry> = {
  standings: {
    versions: { standings: STANDINGS_VERSION },
    digest: digestOf(canonicalJson(standings(fold))),
  },
  breaks: {
    versions: { breaks: BREAKS_VERSION },
    digest: digestOf(
      canonicalJson(
        breaks({
          ...fold,
          stages: [{ id: 'open', division: null }],
          choices: {},
        }),
      ),
    ),
  },
  'season standings': {
    versions: { season: SEASON_VERSION },
    digest: digestOf(
      canonicalJson(
        seasonStandings(
          [
            {
              event: 'ev',
              sanctioned: true,
              format: twoSides,
              entries: field.map((e) => ({
                entry: e.id,
                competitor: e.members[0]!,
                school: null,
              })),
              preliminary: played,
              elimination: { fixtures: [], results: [] },
            },
          ],
          {
            preliminaryWin: { points: 2, cap: null },
            eliminationRound: { points: 3 },
            bestEvents: null,
            topPerSchool: null,
          },
        ),
      ),
    ),
  },
  'ladder input': {
    versions: { ladder: LADDER_INPUT_VERSION },
    digest: digestOf(
      canonicalJson(
        ladderInput({
          rooms: [],
          tournaments: [
            {
              event: 'ev',
              sanctioned: true,
              entries: field,
              results: played.results.map((result, i) => ({
                result,
                fixture: pairings.find((p) => p.id === result.fixture)!.fixture,
                playedAt: `2026-11-01T0${i}:00:00.000Z`,
              })),
            },
          ],
        }),
      ),
    ),
  },
};

/** Refresh an entry by copying the actual value from a failure. */
const locked: Record<string, LockEntry> = {
  'two-sided first round': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '20f2a7fa3d465ef06488514b226dc5ab1856338868b02ac299ef8695ca4b8763',
  },
  'two-sided powered round': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: 'fbfdd1a3d5b6f299527db1128546bcf1578e41402b9d5971716fbf3862f008e7',
  },
  'round robin': {
    versions: {
      engine: 'tab-engine@1',
      method: 'schedule-round-robin@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '3c46b831f16925f19fa7aa9d7c8bdabf679a22ec1489e0dd6ec69f69504171e2',
  },
  'four sides': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-four-side@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '160da40f6fa683e65d1555c124a5999202cea358757d81a46989110ab90688c2',
  },
  sections: {
    versions: {
      engine: 'tab-engine@1',
      method: 'sections@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '170cbd7de0f2b2e4d3f61f0633cf8471b031a09d8dd53cb3333c8bee4aff7d9a',
  },
  elimination: {
    versions: {
      engine: 'tab-engine@1',
      method: 'bracket-progression@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '8a4fab2278b6e6a05ad8289bcf307b9b4d118ae820465ab37971cb40e128a08f',
  },
  'prematched second round': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '5148cdacd1a367dfef82660c355c1241a13b38624a38710d573d4d8cfa85c989',
  },
  'four sides second round': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-four-side@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '26c7121b0ca2537c52cbd1fbd945f334d2c127e444a4e2f3cffacb77779df66a',
  },
  'sections second round': {
    versions: {
      engine: 'tab-engine@1',
      method: 'sections@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '93b63b5d559cbbb730422573004d33a5072a94193e8fdb6b203570c24a79840f',
  },
  standings: {
    versions: { standings: 'standings@1' },
    digest: '7497a4086e98680a468a13b6b2aea4cc4641c2ce72bf363a6d05d01c16c923a6',
  },
  breaks: {
    versions: { breaks: 'breaks@1' },
    digest: 'd4b357fa099a84deb92a1295d0d3a9936cd9f52b043d4f8a63794a2bc6e03c1b',
  },
  'season standings': {
    versions: { season: 'season-standings@1' },
    digest: 'b5aa31ba386d9f3c24c8940edc5a0eaf7b3d0eae2d36e21c132b458ef2f87769',
  },
  'ladder input': {
    versions: { ladder: 'ladder-input@1' },
    digest: 'fc3631684da2c156d8f06d8825ab0be20a13032d54f7cfcd381106af443ea3a1',
  },
};

describe('the behaviour lock', () => {
  test('changing output without raising the version fails; raising it passes', () => {
    const entry = { versions: { method: 'pairing-two-sided@1' }, digest: 'a' };
    assert({
      given:
        'a locked entry, then a new digest under the same version and under a raised one',
      should:
        'hold for the same digest, break for a new one, and pass as raised for a new version',
      actual: [
        lockVerdict(entry, entry).kind,
        lockVerdict(entry, { ...entry, digest: 'b' }).kind,
        lockVerdict(entry, {
          versions: { method: 'pairing-two-sided@2' },
          digest: 'b',
        }).kind,
      ],
      expected: ['held', 'broken', 'raised'],
    });
  });

  test('every corpus draw and fold matches its locked digest', () => {
    const outputs: Record<string, LockEntry> = {
      ...Object.fromEntries(
        Object.entries(corpus).map(([name, input]) => [name, current(input)]),
      ),
      ...folds,
    };
    const outcomes = Object.fromEntries(
      Object.entries(outputs).map(([name, now]) => {
        const verdict = lockVerdict(locked[name], now);
        return [name, verdict.kind === 'broken' ? now : verdict.kind];
      }),
    );
    assert({
      given: 'the corpus drawn by the current engine',
      should:
        'reproduce every locked digest (a broken entry shows the value to lock after raising its version)',
      actual: outcomes,
      expected: Object.fromEntries(
        Object.keys(outputs).map((name) => [
          name,
          'held' as LockVerdict['kind'] | LockEntry,
        ]),
      ),
    });
  });
});
