import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { audienceViewerOf } from './audience-viewer';

setupRitewayBun();

const noop = async () => undefined as never;
const of = (over: Partial<Parameters<typeof audienceViewerOf>[0]>) =>
  audienceViewerOf({
    restricted: false,
    account: { actorId: 'actor' },
    usernameClaimed: true,
    inLiveRoom: false,
    returnTo: '/watch/round',
    requestId: () => 'request',
    actions: { react: noop, reportMessage: noop, postChat: noop },
    ...over,
  });

describe('audienceViewerOf', () => {
  test('a restricted account reads only', () => {
    assert({
      given: 'a restricted account',
      should: 'offer no composer, reaction or report',
      actual: of({ restricted: true }).kind,
      expected: 'restricted',
    });
  });

  test('a visitor signs in and comes back to the page they read', () => {
    assert({
      given: 'no account on the public Round page',
      should: 'return them there through next=',
      actual: of({ account: null }),
      expected: {
        kind: 'visitor',
        signInHref: '/sign-in?next=%2Fwatch%2Fround',
      },
    });
  });

  test('each account gets what it may do', () => {
    assert({
      given: 'no actor, no username, a live-room place, and neither',
      should: 'ask for a username twice, withhold posting, then allow it',
      actual: [
        of({ account: { actorId: null } }).kind,
        of({ usernameClaimed: false }).kind,
        of({ inLiveRoom: true }).kind,
        of({}).kind,
      ],
      expected: ['needs-username', 'needs-username', 'live-room', 'account'],
    });
  });
});
