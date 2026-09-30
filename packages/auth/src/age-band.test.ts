import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { ageBand, type AgeBand } from './index';

setupRitewayBun();

const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe('ageBand', () => {
  const expected: AgeBand[] = [
    'under-13',
    '13-15',
    '13-15',
    '13-15',
    '16-17',
    '16-17',
    'adult',
  ];

  test('changes band in the month the person turns 13, 16 and 18', () => {
    assert({
      given: 'birth month 2010-06 and the months around each birthday year',
      should: 'switch band in June, not before',
      actual: [
        ageBand('2010-06', at('2023-05-31')),
        ageBand('2010-06', at('2023-06-01')),
        ageBand('2010-06', at('2023-06-30')),
        ageBand('2010-06', at('2026-05-31')),
        ageBand('2010-06', at('2026-06-01')),
        ageBand('2010-06', at('2028-05-31')),
        ageBand('2010-06', at('2028-06-01')),
      ],
      expected,
    });
  });

  test('rolls over the year boundary', () => {
    assert({
      given: 'a December birth month and a January birth month',
      should: 'turn 13 in December and January respectively',
      actual: [
        ageBand('2010-12', at('2023-11-30')),
        ageBand('2010-12', at('2023-12-01')),
        ageBand('2011-01', at('2023-12-31')),
        ageBand('2011-01', at('2024-01-01')),
      ],
      expected: ['under-13', '13-15', 'under-13', '13-15'],
    });
  });

  test('treats the current month as the birth month as under 13', () => {
    assert({
      given: 'a birth month equal to the current month',
      should: 'be under-13',
      actual: ageBand('2026-09', at('2026-09-29')),
      expected: 'under-13',
    });
  });

  test('uses UTC month boundaries', () => {
    assert({
      given: 'an instant just before and at midnight UTC on the 1st',
      should: 'switch at UTC midnight',
      actual: [
        ageBand('2010-06', new Date('2023-05-31T23:59:59.999Z')),
        ageBand('2010-06', new Date('2023-06-01T00:00:00.000Z')),
      ],
      expected: ['under-13', '13-15'],
    });
  });

  test('rejects malformed input', async () => {
    const bad: unknown[] = [
      '2010-6',
      '2010-13',
      '2010-00',
      '2010-06-01',
      ' 2010-06',
      '0999-01',
      '',
      null,
      undefined,
      201006,
    ];
    for (const value of bad)
      await assertRejects({
        given: `birth month ${String(value)}`,
        should: 'throw a VALIDATION error',
        actual: () => ageBand(value, at('2026-09-29')),
        code: 'VALIDATION',
      });
  });

  test('rejects a future birth month and an invalid clock', async () => {
    await assertRejects({
      given: 'a birth month after now',
      should: 'throw a VALIDATION error',
      actual: () => ageBand('2026-10', at('2026-09-29')),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'an invalid now',
      should: 'throw a VALIDATION error',
      actual: () => ageBand('2010-06', new Date('nope')),
      code: 'VALIDATION',
    });
  });
});
