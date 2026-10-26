import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { formatStandingSchema } from './format-standing';

setupRitewayBun();

describe('formatStandingSchema', () => {
  test('accepted shapes', () => {
    assert({
      given: 'a Standard standing and a Custom one with typed changes',
      should: 'parse both',
      actual: [
        formatStandingSchema.safeParse({ kind: 'standard', formatId: 'value' })
          .success,
        formatStandingSchema.safeParse({
          kind: 'custom',
          basis: { formatId: 'nsda-policy', role: 'template' },
          changes: [
            {
              kind: 'segment-duration',
              key: '1AC',
              fromMs: 480_000,
              toMs: 360_000,
            },
            { kind: 'in-round-prep', fromMs: 480_000, toMs: null },
            { kind: 'seats', role: 'judge', from: 1, to: 3 },
            { kind: 'segments', added: ['X'], removed: [], changed: [] },
            { kind: 'cross-ex-mode', from: 'ordered', to: 'free' },
            {
              kind: 'interruptions',
              from: { allowed: 'cross_ex_only', minRemainingMs: 30_000 },
              to: null,
            },
            {
              kind: 'yield',
              from: null,
              to: { allowed: true, returnsTime: false },
            },
          ],
        }).success,
        formatStandingSchema.safeParse({
          kind: 'custom',
          basis: null,
          changes: [],
        }).success,
      ],
      expected: [true, true, true],
    });
  });

  test('refused shapes', () => {
    assert({
      given:
        'a change carrying an extra field (such as host-authored text) or an unknown kind',
      should: 'refuse it: the change list is an allowlist',
      actual: [
        formatStandingSchema.safeParse({
          kind: 'custom',
          basis: null,
          changes: [
            { kind: 'countdown', fromMs: 0, toMs: 10_000, text: 'secret' },
          ],
        }).success,
        formatStandingSchema.safeParse({
          kind: 'custom',
          basis: null,
          changes: [{ kind: 'resolutions', from: ['a'], to: ['b'] }],
        }).success,
        formatStandingSchema.safeParse({
          kind: 'standard',
          formatId: 'value',
          changes: [],
        }).success,
      ],
      expected: [false, false, false],
    });
  });
});
