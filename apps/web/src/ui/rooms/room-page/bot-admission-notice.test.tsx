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
  source: {
    kind: 'beta' as const,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-11-01T00:00:00.000Z',
  },
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
      html.includes('20 of 20 bot debates remaining'),
      html.includes('Starting reserves one bot debate'),
      html.includes('an unknown result stays counted'),
      html.includes('2026-11-01'),
      html.includes('can’t start'),
    ],
    expected: [true, true, true, true, false],
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
        html.includes('because access is unavailable'),
        html.includes('because your bot debate allowance is used'),
        html.includes('bots are busy, try again shortly'),
        html.includes('bots are unavailable'),
        html.includes('bot debates remaining'),
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

test('exhausted allowance links to billing while busy bots never become an upsell', () => {
  assert({
    given: 'an exhausted allowance or shared bot capacity',
    should: 'offer plan/usage only for the allowance refusal',
    actual: [
      render(allowance(0, 'allowance')).includes('href="/settings/billing"'),
      render(allowance(3, 'capacity')).includes('href="/settings/billing"'),
    ],
    expected: [true, false],
  });
});
