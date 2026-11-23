import { mock } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ClubInvitationView } from '../../features/clubs/views';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { noAction } from './club-view.test-support';

setupRitewayBun();
const navigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...navigation,
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));
const { ClubInvitationPage } = await import('./invitation-page');

const base = {
  club: { name: 'Lakeside Debate', kind: 'school' as const },
  manager: 'Dana Mensah',
};
const open: ClubInvitationView = {
  kind: 'open',
  ...base,
  email: 'sam@lakeside.edu',
  expiresAt: '2026-12-01T00:00:00.000Z',
  ownPremium: false,
};
const render = (view: ClubInvitationView) =>
  renderAccessible(
    <ClubInvitationPage view={view} username="sam.rivera" action={noAction} />,
  );

test('an open invitation names the club and offers Accept and Decline', () => {
  const view = render(open);
  const text = view.textContent();
  assert({
    given: 'an open invitation for the signed-in invitee',
    should: 'name the inviter, the club and the seat, with both answers',
    actual: [
      text.includes('For @sam.rivera'),
      text.includes('Dana Mensah invited you to'),
      text.includes('Lakeside Debate'),
      text.includes('A Premium seat, paid by the club'),
      view.has('button', 'Accept the seat'),
      view.has('button', 'Decline'),
      text.includes('Open until 1 Dec 2026'),
      text.includes('Your own subscription stays'),
      text.includes('Your coach sees'),
    ],
    expected: [true, true, true, true, true, true, true, false, false],
  });
});

test('an invitee who pays for Premium is told their own subscription stays until they cancel it', () => {
  const view = render({ ...open, ownPremium: true });
  assert({
    given: 'an invitee with their own Premium subscription',
    should: 'say it stays until they cancel it and link to manage it',
    actual: [
      view
        .textContent()
        .includes(
          'You already pay for Premium. Your own subscription stays until you cancel it.',
        ),
      view.attribute('link', 'Manage your subscription', 'href'),
    ],
    expected: [true, '/settings/billing'],
  });
});

test('expired, already-seated and seated-elsewhere invitations offer no answer', () => {
  const states = (['expired', 'seated-here', 'seated-elsewhere'] as const).map(
    (kind) => render({ kind, ...base }),
  );
  assert({
    given: 'each closed invitation state',
    should: 'say why in plain words and offer no Accept',
    actual: states.map((view) => [
      view.has('button', 'Accept the seat'),
      /expired|already hold a seat in Lakeside Debate|another club/.test(
        view.text('status'),
      ),
    ]),
    expected: [
      [false, true],
      [false, true],
      [false, true],
    ],
  });
});
