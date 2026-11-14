import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { draw } from '../draw';
import {
  randomPreset,
  roundRobinPreset,
  swissPower,
} from '../simulate/presets';
import {
  entry,
  fourSides,
  judge,
  numbers,
  playEvent,
  speakers,
  twoSides,
  slotCase,
  type Played,
} from './build.test-support';
import { check } from './index';

setupRitewayBun();

/** Every round whose verdict was not clean, with what was found. */
const rejected = (played: readonly Played[], label: string) =>
  played.flatMap(({ input, answer }, round) => {
    const verdict = check(input, answer);
    return verdict.ok
      ? []
      : [
          {
            label,
            round: round + 1,
            answer: answer.kind,
            violations: verdict.violations,
          },
        ];
  });

const field = (seed: number, size: number) => {
  const next = numbers('field', seed);
  return Array.from({ length: size }, (_, i) =>
    entry(`e${i}`, next(3) === 0 ? null : `s${next(3)}`),
  );
};

describe('check: engine draws are accepted', () => {
  test('two-sided rounds 1 to 3 with judges, over seeded fields', () => {
    const found = [];
    for (let seed = 0; seed < 16; seed += 1) {
      const size = 5 + (seed % 6);
      const judges = Array.from({ length: Math.ceil(size / 2) + 1 }, (_, i) =>
        judge(`j${i}`, {
          chair: i % 3 !== 0,
          protection:
            i % 2 === 0 ? [{ scope: 'school', key: `s${i % 3}` }] : [],
        }),
      );
      const settings = [swissPower, randomPreset, roundRobinPreset][seed % 3]!;
      found.push(
        ...rejected(
          playEvent({
            label: 'two',
            seed,
            format: twoSides,
            entries: field(seed, size),
            settings,
            judges,
            rounds: 3,
          }),
          `seed ${seed}`,
        ),
      );
    }
    assert({
      given:
        'sixteen seeded two-sided tournaments of 5 to 10 entries, three rounds each, with judges',
      should: 'accept every engine draw',
      actual: found,
      expected: [],
    });
  });

  test('two-sided rounds 1 to 3 without judges, where optimality is brute-forced', () => {
    const found = [];
    for (let seed = 0; seed < 16; seed += 1) {
      const size = 4 + (seed % 7);
      found.push(
        ...rejected(
          playEvent({
            label: 'bare',
            seed,
            format: twoSides,
            entries: field(seed, size),
            settings: swissPower,
            judges: null,
            rounds: 3,
          }),
          `seed ${seed}`,
        ),
      );
    }
    assert({
      given:
        'sixteen seeded power-paired fields of 4 to 10 entries without judges',
      should: 'find no plan lexicographically better than the engine draw',
      actual: found,
      expected: [],
    });
  });

  test('a four-side event', () => {
    const found = [];
    for (let seed = 0; seed < 4; seed += 1) {
      const judges = Array.from({ length: 3 }, (_, i) => judge(`j${i}`));
      found.push(
        ...rejected(
          playEvent({
            label: 'four',
            seed,
            format: fourSides,
            entries: field(seed, 8),
            settings: swissPower,
            judges,
            rounds: 3,
          }),
          `seed ${seed}`,
        ),
      );
    }
    assert({
      given: 'four seeded eight-entry four-side events, three rounds each',
      should: 'accept every engine draw',
      actual: found,
      expected: [],
    });
  });

  test('a speech event', () => {
    const found = [];
    for (let seed = 0; seed < 4; seed += 1) {
      const judges = Array.from({ length: 3 }, (_, i) => judge(`j${i}`));
      found.push(
        ...rejected(
          playEvent({
            label: 'speech',
            seed,
            format: speakers,
            entries: field(seed, 11),
            settings: swissPower,
            judges,
            rounds: 3,
          }),
          `seed ${seed}`,
        ),
      );
    }
    assert({
      given: 'four seeded eleven-speaker events, three rounds each',
      should: 'accept every engine draw',
      actual: found,
      expected: [],
    });
  });

  test('a slot with two events and a commitment', () => {
    const input = slotCase();
    const answer = draw(input);
    assert({
      given:
        'a slot of a debate and a speech event, beside a commitment holding a judge',
      should: 'accept the engine draw',
      actual: { kind: answer.kind, verdict: check(input, answer) },
      expected: { kind: 'drawn', verdict: { ok: true, violations: [] } },
    });
  });
});
