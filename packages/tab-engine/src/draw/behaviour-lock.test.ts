import { canonicalJson, digestOf } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Draw, DrawInput } from '../shapes/draw';
import { roundRobinPreset } from '../simulate/presets';
import { draw } from './index';
import {
  drawsOf,
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
  const same =
    locked !== undefined &&
    canonicalJson(locked.versions) === canonicalJson(current.versions);
  if (!same) return { kind: 'raised' };
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

const current = (input: DrawInput): LockEntry => {
  const d: Draw = drawsOf(draw(input))[0]!;
  return { versions: d.inputs.engine, digest: digestOf(canonicalJson(d)) };
};

/** Refresh an entry by copying the actual value from a failure. */
const locked: Record<string, LockEntry> = {
  'two-sided first round': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
    },
    digest: '9f990611220e176af2c010d8ae2b5830ec494296434decdd85b055902f2f5d3a',
  },
  'two-sided powered round': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-two-sided@1',
      judges: 'judges@1',
    },
    digest: '81690f0e885dc0923b832f0ef178cf2152ab5749f33253bd4cf426ef08d99148',
  },
  'round robin': {
    versions: {
      engine: 'tab-engine@1',
      method: 'schedule-round-robin@1',
      judges: 'judges@1',
    },
    digest: '05cdc4cbb4e9b968abd46e9775cd82e5aaa5310865c75f78ba873ff4f4940917',
  },
  'four sides': {
    versions: {
      engine: 'tab-engine@1',
      method: 'pairing-four-side@1',
      judges: 'judges@1',
    },
    digest: 'a89dbbda017e6713e047b9627d27970db34ee539ebc4d5747658bf9b80f05e13',
  },
  sections: {
    versions: {
      engine: 'tab-engine@1',
      method: 'sections@1',
      judges: 'judges@1',
    },
    digest: '322021cd6a724d3b477541e98b383df13b7072beb8ba5e88b9eb7ddf6bf3f210',
  },
  elimination: {
    versions: {
      engine: 'tab-engine@1',
      method: 'bracket-progression@1',
      judges: 'judges@1',
    },
    digest: '3d7fd4b18094b38f7f451c30fb5ffc0f0362d1127b14738e457f754f6297a6dd',
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

  test('every corpus draw matches its locked digest', () => {
    const outcomes = Object.fromEntries(
      Object.entries(corpus).map(([name, input]) => {
        const now = current(input);
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
        Object.keys(corpus).map((name) => [
          name,
          'held' as LockVerdict['kind'] | LockEntry,
        ]),
      ),
    });
  });
});
