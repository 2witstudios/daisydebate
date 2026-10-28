import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { tightenOnly } from './tighten-only';

setupRitewayBun();

test('a tighten-only override keeps the floor, takes a tighter value and refuses a looser one', async () => {
  const { atMost, atLeast } = tightenOnly('POLICY');
  assert({
    given: 'no value, then a tighter value, on each side',
    should: 'return the floor, then the tighter value',
    actual: [
      atMost('max', 10, undefined),
      atMost('max', 10, 4),
      atLeast('min', 10, undefined),
      atLeast('min', 10, 20),
    ],
    expected: [10, 4, 10, 20],
  });
  for (const [given, loosen] of [
    ['a larger maximum', () => atMost('max', 10, 11)],
    ['a smaller minimum', () => atLeast('min', 10, 9)],
  ] as const)
    await assertRejects({
      given,
      should: 'refuse it as a validation error rather than clamp it',
      actual: async () => loosen(),
      code: 'VALIDATION',
    });
});

test('a refused override names its prefixed field', () => {
  const { atMost } = tightenOnly('POLICY');
  let message = '';
  try {
    atMost('max', 10, 11);
  } catch (error) {
    message = (error as Error).message;
  }
  assert({
    given: 'a looser value for POLICY.max',
    should: 'name the field so the boot refusal says what to fix',
    actual: message,
    expected: 'POLICY.max would loosen DEC-251',
  });
});

test('windows tighten each window’s count and keep the window lengths', async () => {
  const { windows } = tightenOnly('POLICY');
  const floor = [
    { max: 10, windowSeconds: 10 },
    { max: 30, windowSeconds: 60 },
  ];
  assert({
    given: 'no override, then fewer per window',
    should: 'keep the floor, then take the tighter counts',
    actual: [
      windows('w', floor, undefined),
      windows('w', floor, [
        { max: 30, windowSeconds: 60 },
        { max: 5, windowSeconds: 10 },
      ]),
    ],
    expected: [
      floor,
      [
        { max: 5, windowSeconds: 10 },
        { max: 30, windowSeconds: 60 },
      ],
    ],
  });
  for (const [given, value] of [
    [
      'a larger count',
      [
        { max: 11, windowSeconds: 10 },
        { max: 30, windowSeconds: 60 },
      ],
    ],
    ['a missing window', [{ max: 10, windowSeconds: 10 }]],
    [
      'a different window',
      [
        { max: 10, windowSeconds: 10 },
        { max: 30, windowSeconds: 61 },
      ],
    ],
  ] as const)
    await assertRejects({
      given,
      should: 'refuse it rather than clamp it',
      actual: async () => windows('w', floor, value),
      code: 'VALIDATION',
    });
});
