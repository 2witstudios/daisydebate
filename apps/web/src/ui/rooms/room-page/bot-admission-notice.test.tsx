import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomView } from '@daisy/protocol';
import { BotAdmissionNotice } from './bot-admission-notice';
setupRitewayBun();

type Refusal = Extract<
  NonNullable<RoomView['botAdmission']>,
  { kind: 'allowance' }
>['refusal'];
const allowance = (
  refusal: Refusal,
): NonNullable<RoomView['botAdmission']> => ({
  kind: 'allowance',
  refusal,
});
const render = (admission: RoomView['botAdmission']) =>
  renderToStaticMarkup(<BotAdmissionNotice admission={admission} />);
const words = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(/&#?\w+;/g, ' ');

test('a bot-debater cast that can start says nothing and never counts', () => {
  assert({
    given: 'a host whose bot Round is admitted',
    should:
      'render nothing: no remaining count, no period, no reservation copy',
    actual: render(allowance(null)),
    expected: '',
  });
});

test('a free account past its one bot Round sees the upgrade panel in place', () => {
  const html = render(allowance('free-limit-reached'));
  assert({
    given: 'a free host starting a second bot Round',
    should:
      'show the Premium panel with Get Premium and Find a person, and no number',
    actual: [
      html.includes('Your free bot Round is used'),
      html.includes('Premium gives you unlimited bot Rounds.'),
      html.includes('href="/premium"'),
      html.includes('Find a person'),
      /\d/.test(words(html)),
    ],
    expected: [true, true, true, true, false],
  });
});

test('each other refusal says why a bot-debater round cannot start, never a count', () => {
  const cases = [
    ['an ineligible host', allowance('not-eligible')],
    ['the fair-use ceiling', allowance('abuse-ceiling')],
    ['busy bots', allowance('capacity')],
    ['unavailable admission', { kind: 'unavailable' } as const],
  ] as const;
  assert({
    given: 'an ineligible host, the daily ceiling, busy and unavailable bots',
    should: 'name the actual reason, never as an upsell or a number',
    actual: cases.map(([given, admission]) => {
      const html = render(admission);
      return [
        given,
        html.includes('because access is unavailable'),
        html.includes('fair-use ceiling'),
        html.includes('bots are busy, try again shortly'),
        html.includes('bots are unavailable'),
        html.includes('href="/premium"') || /\d/.test(words(html)),
      ];
    }),
    expected: [
      ['an ineligible host', true, false, false, false, false],
      ['the fair-use ceiling', false, true, false, false, false],
      ['busy bots', false, false, true, false, false],
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

test('renewal grace links to billing while busy bots never do', () => {
  assert({
    given: 'renewal grace or shared bot capacity',
    should: 'offer billing management only for grace',
    actual: [
      render(allowance('renewal-grace')).includes('href="/settings/billing"'),
      render(allowance('capacity')).includes('href="/settings/billing"'),
    ],
    expected: [true, false],
  });
});
