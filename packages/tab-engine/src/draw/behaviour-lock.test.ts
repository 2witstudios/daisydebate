import { canonicalJson, digestOf } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assess } from '../assess';
import { ASSESS_VERSION } from '../assess/assessment';
import type { Draw, DrawInput, Plan } from '../shapes/draw';
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
const handPlanned = (() => {
  const input = corpus['two-sided powered round']!;
  const d = drawsOf(draw(input))[0]!;
  const pairing = d.add.find((a) => a.fixture.kind === 'pairing')!;
  const met = played.fixtures.find(
    (f) => f.fixture.kind === 'pairing',
  )!.fixture;
  return assess(input, [
    {
      event: d.event,
      keep: d.keep,
      add: [
        ...d.add,
        { ordinal: d.add.length + 1, fixture: pairing.fixture },
        { ordinal: d.add.length + 2, fixture: met },
      ],
      withdraw: d.withdraw,
    } as Plan,
  ]);
})();
const folds: Record<string, LockEntry> = {
  'assess of a hand plan': {
    versions: { assess: ASSESS_VERSION },
    digest: digestOf(canonicalJson(handPlanned)),
  },
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
              results: played.results
                .filter((result) => result.kind === 'decided')
                .map((result, i) => ({
                  result,
                  fixture: pairings.find((p) => p.id === result.fixture)!
                    .fixture,
                  playedAt: `2026-11-01T0${i}:00:00.000Z`,
                })),
            },
          ],
        }),
      ),
    ),
  },
};

/**
 * Refresh an entry by copying the actual value from a failure. Swiss inputs
 * use the catalogue's record-first preference order; these digests include
 * that resolved input, without changing the engine or method versions.
 */
const locked: Record<string, LockEntry> = {
  'two-sided first round': {
    versions: {
      engine: 'tab-engine@2',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '09e4325433306f49a5379e7eb1bc46cd25eef6314ea17394e6b107f26773824e',
  },
  'two-sided powered round': {
    versions: {
      engine: 'tab-engine@2',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '718c8f0f0becceb90df82353c28d2c9e38b40e9f9ce4df97bdb0e04c8cf52b2b',
  },
  'round robin': {
    versions: {
      engine: 'tab-engine@2',
      method: 'schedule-round-robin@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '653bbc26be72a2b76feb1f293d88bf0c39ec2863ad1a745baccdee9741c7773b',
  },
  'four sides': {
    versions: {
      engine: 'tab-engine@2',
      method: 'pairing-four-side@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: 'a4f824e484bc5776596836e27d5d0a88ab9ce45903bf75bae10457147c651a2e',
  },
  sections: {
    versions: {
      engine: 'tab-engine@2',
      method: 'sections@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: 'bdb308c29cd482e3e41386ed67f3b95e1d79e51222b221148b42cd3dbbf70d31',
  },
  elimination: {
    versions: {
      engine: 'tab-engine@2',
      method: 'bracket-progression@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: 'd02310f8023f8f7ae3624af300edf340d7739b0580cf0ffd7d1f36725eeb5520',
  },
  'prematched second round': {
    versions: {
      engine: 'tab-engine@2',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: 'cd7fa547a528bcae9a1f14371bce740b8753d15a113ed283de94de48bd5bb367',
  },
  'four sides second round': {
    versions: {
      engine: 'tab-engine@2',
      method: 'pairing-four-side@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: 'ce3f212fe7eacd4b39799840c4acadd24fd2b730a300fe3344b4e2d7093053e9',
  },
  'sections second round': {
    versions: {
      engine: 'tab-engine@2',
      method: 'sections@1',
      judges: 'judges@1',
      assess: 'assess@1',
    },
    digest: '8fa734bd48d83fae380ebdc8aa3f3c2e97b15de238bf4583f39c5aead2014f75',
  },
  'assess of a hand plan': {
    versions: { assess: 'assess@1' },
    digest: 'fa2fe043c9cd9c84cdbd5b14660596d9e7b9732dd2000d74bab8a33cc4789d3b',
  },
  standings: {
    versions: { standings: 'standings@2' },
    digest: '39b277b98b754581cd3990385f2fe31fca9fb9806d2de7548e096dcab54cccbd',
  },
  breaks: {
    versions: { breaks: 'breaks@1' },
    digest: 'd4b357fa099a84deb92a1295d0d3a9936cd9f52b043d4f8a63794a2bc6e03c1b',
  },
  'season standings': {
    versions: { season: 'season-standings@2' },
    digest: 'f0b46afd4ad0b6aefa5ed45e43b98f6cbe969dd145a7e0e571e7077cffde8254',
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
