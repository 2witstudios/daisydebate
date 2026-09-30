import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from './debate-source';
import { openReplay } from './open-replay';
import { defaultReplayQuery } from './replay-query';

setupRitewayBun();

const kind = (id: string) =>
  openReplay(id, watchViewer(true), defaultReplayQuery).kind;

describe('openReplay over the sample recordings', () => {
  test('each sample reaches its screen', () => {
    assert({
      given: 'the sample ids',
      should: 'reach watch, processing, expired and the one unavailable answer',
      actual: [
        kind('semifinal-rehearsal'),
        kind('evening-round'),
        kind('just-finished'),
        kind('older-round'),
        kind('closed-door-recording'),
        kind('top-of-the-ladder'),
        kind('nope'),
      ],
      expected: [
        'watch',
        'watch',
        'processing',
        'expired',
        'unavailable',
        'unavailable',
        'unavailable',
      ],
    });
  });
});
