import { sampleWatchSource } from './sample-source.test-support';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { openSpectate } from './open-spectate';
import { defaultSpectateQuery } from './spectate-query';
import { watchViewer } from './sample-source.test-support';

setupRitewayBun();

const member = watchViewer(true);
const kind = (id: string, viewer = member) =>
  openSpectate(id, viewer, defaultSpectateQuery, sampleWatchSource).kind;

describe('openSpectate over the sample Rounds', () => {
  test('each sample Round reaches its screen', () => {
    assert({
      given: 'the sample Round ids',
      should: 'reach every refusal and the watch view',
      actual: [
        kind('top-of-the-ladder'),
        kind('semifinal-rehearsal'),
        kind('starting-soon'),
        kind('packed-house'),
        kind('your-own-round'),
        kind('host-restricted'),
        kind('closed-door'),
        kind('no-such-round'),
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

  test('a visitor watches a public Round without an account', () => {
    const anonymous = watchViewer(false);
    assert({
      given: 'an anonymous viewer at a public live Round and a private one',
      should: 'open the public one and answer unavailable for the private one',
      actual: [
        kind('top-of-the-ladder', anonymous),
        kind('closed-door', anonymous),
      ],
      expected: ['watch', 'unavailable'],
    });
  });
});
