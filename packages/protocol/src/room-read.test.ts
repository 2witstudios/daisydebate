import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomViewSchema } from './room-read';

setupRitewayBun();

const botAdmission = roomViewSchema.shape.botAdmission;
const allowance = (refusal: unknown) => ({ kind: 'allowance', refusal });

test('Room botAdmission contract carries only the decision', () => {
  const cases = [
    ['an admitted host', allowance(null)],
    ['an ineligible host', allowance('not-eligible')],
    ['a used free bot Round', allowance('free-limit-reached')],
    ['the fair-use ceiling', allowance('abuse-ceiling')],
    ['busy bots', allowance('capacity')],
    ['renewal grace', allowance('renewal-grace')],
    ['the retired allowance refusal', allowance('allowance')],
    [
      'a count or limit (PYL-10)',
      { ...allowance(null), limit: 20, remaining: 19 },
    ],
    ['a period source', { ...allowance(null), source: { kind: 'lifetime' } }],
    ['a removed blanket-free AI-judge claim', { kind: 'free' }],
  ] as const;
  assert({
    given: 'each refusal, the retired vocabulary, and any count or period',
    should: 'accept only the decision and refuse every number',
    actual: cases.map(([given, value]) => [
      given,
      botAdmission.safeParse(value).success,
    ]),
    expected: [
      ['an admitted host', true],
      ['an ineligible host', true],
      ['a used free bot Round', true],
      ['the fair-use ceiling', true],
      ['busy bots', true],
      ['renewal grace', true],
      ['the retired allowance refusal', false],
      ['a count or limit (PYL-10)', false],
      ['a period source', false],
      ['a removed blanket-free AI-judge claim', false],
    ],
  });
});
