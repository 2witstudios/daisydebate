import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { EngineDrawInput, EngineFormat } from '../commands/tab-engine';
import { engineSettings } from './engine-settings';
import { tabEngine } from './tab-engine';
setupRitewayBun();
const settings = engineSettings([], [], {
  'room.timing': { preRoundPrepMs: 0, inRoundPrepMsPerSide: 0, countdownMs: 0 },
  'room.floor': { interruptions: null, yielding: null },
});
const input = (format: EngineFormat, count: number): EngineDrawInput => ({
  call: 'windowed',
  event: {
    event: 'event',
    format,
    stage: { kind: 'preliminary' },
    tabRound: 1,
    entries: Array.from({ length: count }, (_, n) => ({
      id: `entry-${n}`,
      members: [`person-${n}`],
      protection: [],
      division: null,
      status: 'active',
      breakEligible: true,
    })),
    history: { fixtures: [], results: [] },
    settings,
    cutoff: 0,
    ratings: null,
    existing: [],
  },
  judges: null,
  seed: new Uint8Array(32).fill(0xab),
});
test('the wired draw port runs the actual engine for every format and retains its reproducibility record', () => {
  const cases = [
    input({ outcome: 'winner', sides: 2 }, 2),
    input({ outcome: 'ranking', of: 'sides', sides: 4 }, 4),
    input({ outcome: 'ranking', of: 'speakers' }, 6),
  ];
  assert({
    given: 'actual resolved defaults, accepted entrants and a fixed seed',
    should:
      'produce repeatable format-shaped fixtures with the actual calculation and seed recorded',
    actual: cases.map((request) => {
      const answer = tabEngine.draw(request);
      if (answer.kind !== 'drawn') return answer.kind;
      const planned = answer.draws[0]!;
      return [
        planned.add[0]?.fixture.kind,
        planned.inputs.engine.engine,
        planned.inputs.seed,
        planned.inputs.cutoff,
        planned.inputs.results,
        JSON.stringify(answer) === JSON.stringify(tabEngine.draw(request)),
      ];
    }),
    expected: ['pairing', 'pairing', 'section'].map((kind) => [
      kind,
      'tab-engine@1',
      'ab'.repeat(32),
      0,
      [],
      true,
    ]),
  });
});
test('a structurally invalid typed fixture is reported without an unchecked tuple cast', () => {
  assert({
    given: 'a three-entry pairing handed back for a two-sided format',
    should:
      'retain the engine port structural finding instead of passing it as a valid pairing',
    actual: tabEngine
      .assess(input({ outcome: 'winner', sides: 2 }, 2), [
        {
          event: 'event',
          keep: [],
          withdraw: [],
          add: [
            {
              ordinal: 0,
              fixture: {
                kind: 'pairing',
                sides: ['entry-0', 'entry-1', 'entry-2'],
                panel: [],
              },
            },
          ],
        },
      ])
      .flatMap((assessment) => assessment.invalid.map((fact) => fact.fact)),
    expected: ['fixture_kind'],
  });
});
