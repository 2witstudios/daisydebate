import { assert, setupRitewayBun, test } from 'riteway/bun';
import { AI_ROUND_MONTHLY_CAP_MAX, roomViewSchema } from './room-read';

setupRitewayBun();

const botAdmission = roomViewSchema.shape.botAdmission;
const allowance = (limit: number, remaining: number, refusal: unknown) => ({
  kind: 'allowance',
  limit,
  remaining,
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  refusal,
});

test('Room botAdmission contract', () => {
  const cases = [
    ['an ineligible host', allowance(0, 0, 'not-eligible')],
    ['the beta cap of 20', allowance(20, 20, null)],
    ['a spent beta cap', allowance(20, 0, 'allowance')],
    [
      'the configurable maximum',
      allowance(AI_ROUND_MONTHLY_CAP_MAX, 1, 'capacity'),
    ],
    [
      'a cap above the maximum',
      allowance(AI_ROUND_MONTHLY_CAP_MAX + 1, 0, null),
    ],
    ['more remaining than the limit', allowance(20, 21, null)],
    ['a fractional limit', allowance(1.5, 0, null)],
    ['an unknown refusal', allowance(20, 0, 'premium')],
    ['a free AI-judge-only cast', { kind: 'free' }],
  ] as const;
  assert({
    given: 'allowance metadata at 0, 20, the maximum and beyond',
    should: 'accept any integer cap up to the maximum with remaining within it',
    actual: cases.map(([given, value]) => [
      given,
      botAdmission.safeParse(value).success,
    ]),
    expected: [
      ['an ineligible host', true],
      ['the beta cap of 20', true],
      ['a spent beta cap', true],
      ['the configurable maximum', true],
      ['a cap above the maximum', false],
      ['more remaining than the limit', false],
      ['a fractional limit', false],
      ['an unknown refusal', false],
      ['a free AI-judge-only cast', true],
    ],
  });
});
