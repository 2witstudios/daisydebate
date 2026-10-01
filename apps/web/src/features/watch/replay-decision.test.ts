import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { findDebate, watchViewer } from './debate-source';
import { decideReplay } from './replay-decision';

setupRitewayBun();

const decide = (id: string, signedIn = true) =>
  decideReplay(findDebate(id), watchViewer(signedIn));

describe('decideReplay', () => {
  test('each sample recording reaches its state', () => {
    assert({
      given:
        'public, unlisted, processing, expired, private, live and missing recordings',
      should:
        'watch, watch, processing, expired, unavailable, unavailable, unavailable',
      actual: [
        decide('semifinal-rehearsal'),
        decide('fast-rounds'),
        decide('just-finished'),
        decide('older-round'),
        decide('closed-door-recording'),
        decide('top-of-the-ladder'),
        decide('nope'),
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

  test('a private recording opens for the people seated in it', () => {
    assert({
      given: "the viewer's own private practice",
      should: 'watch',
      actual: decide('practice-with-a-friend'),
      expected: 'watch',
    });
  });
});
