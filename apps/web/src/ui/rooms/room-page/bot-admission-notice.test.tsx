import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoomView } from '@daisy/protocol/room-contract';
import { renderAccessible } from '../../../test-support/rendered/accessible';
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
  renderAccessible(<BotAdmissionNotice admission={admission} />);
/** What a render says and links to: nothing at all reads as ['', []]. */
const said = (admission: RoomView['botAdmission']) => {
  const view = render(admission);
  return [view.textContent(), view.names('link')];
};

test('a bot-debater cast that can start says nothing and never counts', () => {
  assert({
    given: 'a host whose bot Round is admitted',
    should:
      'render nothing: no remaining count, no period, no reservation copy',
    actual: said(allowance(null)),
    expected: ['', []],
  });
});

test('a free account past its one bot Round is pointed to a person, never to Premium', () => {
  const view = render(allowance('free-limit-reached'));
  const html = view.text('status');
  assert({
    given: 'a free host starting a second bot Round',
    should:
      'say the free bot Round is used and link Find a person, with no Premium offer and no number',
    actual: [
      html.includes('Your free bot Round is used'),
      /premium|unlimited/i.test(view.textContent()),
      view.attribute('link', 'Find a person', 'href'),
      view.names('link'),
      /\d/.test(view.textContent()),
    ],
    expected: [true, false, '/play', ['Find a person'], false],
  });
});

test('a host without the bot-debates release reads coming soon and nothing to buy', () => {
  assert({
    given: 'a bot-debater cast whose host has bot debates unreleased',
    should: 'say only that bot debates are coming soon, with no link',
    actual: said({ kind: 'coming-soon' }),
    expected: ['Bot debates are coming soon.', []],
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
      const view = render(admission);
      const html = view.text('status');
      return [
        given,
        html.includes('because access is unavailable'),
        html.includes('fair-use ceiling'),
        html.includes('bots are busy, try again shortly'),
        html.includes('bots are unavailable'),
        view
          .all('link')
          .some((link) => link.getAttribute('href') === '/premium') ||
          /\d/.test(view.textContent()),
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
    actual: said(null),
    expected: ['', []],
  });
});

test('renewal grace links to billing while busy bots never do', () => {
  assert({
    given: 'renewal grace or shared bot capacity',
    should: 'offer billing management only for grace',
    actual: [
      render(allowance('renewal-grace'))
        .all('link')
        .map((link) => link.getAttribute('href')),
      render(allowance('capacity'))
        .all('link')
        .map((link) => link.getAttribute('href')),
    ],
    expected: [['/settings/billing'], []],
  });
});
