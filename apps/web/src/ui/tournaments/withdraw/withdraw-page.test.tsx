import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTournament } from '../../../features/tournaments/get-tournament';
import { withdrawScreen } from '../../../features/tournaments/withdraw';
import { WithdrawPage } from './withdraw-page';

setupRitewayBun();

const render = (id: string) => {
  const view = getTournament(id, true);
  if (!view) throw new Error(`no sample ${id}`);
  return renderToString(
    h(WithdrawPage, {
      screen: withdrawScreen(view),
      tournament: view.tournament,
    }),
  );
};

describe('WithdrawPage', () => {
  test('before the bracket: costs nothing, withdraw answers as a sample action, keep links back', () => {
    const html = render('autumn-open');
    assert({
      given: 'a registered viewer before the bracket',
      should:
        'explain, answer Withdraw as a sample action and link Keep my place',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Withdraw from Autumn Open?'),
        html.includes('Your place goes to the next person on the waitlist.'),
        html.includes('href="?did=Withdraw"'),
        /href="\/tournaments\/autumn-open"[^>]*>Keep my place</.test(html),
      ],
      expected: [1, true, true, true, true],
    });
  });

  test('leaving the waitlist', () => {
    const html = render('novice-cup');
    assert({
      given: 'a waitlisted viewer at position 2',
      should: 'name the position and offer to stay',
      actual: [
        html.includes('Leave the waitlist of Novice Cup?'),
        html.includes('position 2'),
        html.includes('Stay on the waitlist'),
      ],
      expected: [true, true, true],
    });
  });

  test('after the bracket: the opponent gets a bye, the reason box is typeable', () => {
    const html = render('hollow-cup');
    assert({
      given: 'a registered viewer after the bracket',
      should:
        'name the opponent, log the late withdrawal and offer a typeable reason',
      actual: [
        html.includes('Withdraw after the bracket is out?'),
        html.includes('@debater-k'),
        html.includes('recorded in the tournament log'),
        /<input id="reason"/.test(html) &&
          !/<input id="reason"[^>]*disabled/.test(html),
        html.includes('Withdraw and give a bye'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('not entered', () => {
    const html = render('weeknight-sprint');
    assert({
      given: 'a viewer who is not entered',
      should: 'say so with no confirm action',
      actual: [
        html.includes('You are not entered in Weeknight Sprint'),
        html.includes('disabled=""'),
      ],
      expected: [true, false],
    });
  });
});
