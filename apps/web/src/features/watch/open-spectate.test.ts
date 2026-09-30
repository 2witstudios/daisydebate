import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { openSpectate } from './open-spectate';
import { defaultSpectateQuery } from './spectate-query';
import { watchViewer } from './debate-source';

setupRitewayBun();

const member = watchViewer(true);
const kind = (id: string, viewer = member) =>
  openSpectate(id, viewer, defaultSpectateQuery).kind;

describe('openSpectate over the sample debates', () => {
  test('each sample debate reaches its screen', () => {
    assert({
      given: 'the sample debate ids',
      should: 'reach every refusal and the watch view',
      actual: [
        kind('top-of-the-ladder'),
        kind('semifinal-rehearsal'),
        kind('starting-soon'),
        kind('packed-house'),
        kind('your-own-debate'),
        kind('host-restricted'),
        kind('closed-door'),
        kind('no-such-debate'),
      ],
      expected: [
        'watch',
        'watch',
        'upcoming',
        'full',
        'conflict',
        'revoked',
        'unavailable',
        'unavailable',
      ],
    });
  });

  test('signed-out visitors are sent to sign in and back', () => {
    const anonymous = watchViewer(false);
    const open = openSpectate(
      'top-of-the-ladder',
      anonymous,
      defaultSpectateQuery,
    );
    const hidden = openSpectate('closed-door', anonymous, defaultSpectateQuery);
    assert({
      given: 'an anonymous viewer at a public live debate and a private one',
      should: 'show a teaser only for the public one, both signing in to it',
      actual: [
        open.kind === 'signed-out' ? open.teaser?.title : 'wrong',
        open.kind === 'signed-out' ? open.signInHref : 'wrong',
        hidden.kind === 'signed-out' ? hidden.teaser : 'wrong',
      ],
      expected: [
        'Top of the ladder',
        '/sign-in?next=%2Fwatch%2Ftop-of-the-ladder',
        null,
      ],
    });
  });
});
