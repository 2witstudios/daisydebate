import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '@daisy/protocol';
import { BotAdmissionNotice } from './bot-admission-notice';
setupRitewayBun();

const allowance = (
  remaining: number,
  refusal: 'not-eligible' | 'allowance' | 'capacity' | null,
  limit = 20,
): NonNullable<RoomView['botAdmission']> => ({
  kind: 'allowance',
  limit,
  remaining,
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  refusal,
});
const render = (admission: RoomView['botAdmission']) =>
  renderToStaticMarkup(<BotAdmissionNotice admission={admission} />);

test('a bot-debater cast states the monthly allowance and what starting spends', () => {
  const html = render(allowance(20, null));
  assert({
    given: 'an approved host with the full beta cap of 20',
    should:
      'say how many AI rounds are left this month and that this cast uses one',
    actual: [
      html.includes('20 of 20 AI rounds left this month'),
      html.includes('A bot debates in this round, so starting it uses one'),
      html.includes('you get it back'),
      html.includes('2026-11-01'),
      html.includes('can’t start'),
    ],
    expected: [true, true, true, true, false],
  });
});

test('an AI-judge-only cast says the judge is free', () => {
  const html = render({ kind: 'free' });
  assert({
    given: 'human debaters with only an AI judge',
    should: 'state that this exact cast spends no AI round',
    actual: [
      html.includes('The AI judge is free'),
      html.includes('doesn’t use one of your AI rounds'),
      html.includes('rounds left'),
    ],
    expected: [true, true, false],
  });
});

test('each refusal says why a bot-debater round cannot start, never a wrong reason', () => {
  const cases = [
    ['an ineligible host', allowance(0, 'not-eligible', 0)],
    ['a spent allowance', allowance(0, 'allowance')],
    ['busy bots', allowance(3, 'capacity')],
    ['unavailable admission', { kind: 'unavailable' } as const],
  ] as const;
  assert({
    given: 'an ineligible host, a spent allowance, busy and unavailable bots',
    should: 'name the actual reason and hide counts that do not apply',
    actual: cases.map(([given, admission]) => {
      const html = render(admission);
      return [
        given,
        html.includes('approved beta testers'),
        html.includes('until you have an AI round left this month'),
        html.includes('bots are busy, try again shortly'),
        html.includes('bots are unavailable'),
        html.includes('rounds left'),
      ];
    }),
    expected: [
      ['an ineligible host', true, false, false, false, false],
      ['a spent allowance', false, true, false, false, true],
      ['busy bots', false, false, true, false, true],
      ['unavailable admission', false, false, false, true, false],
    ],
  });
  assert({
    given: 'no host-only admission metadata',
    should: 'reveal nothing',
    actual: render(null),
    expected: '',
  });
});
