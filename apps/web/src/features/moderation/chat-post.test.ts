import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideChatPost } from './chat-post';

setupRitewayBun();

const facts = {
  banned: false,
  slowModeSeconds: 0,
  lastPostAtMs: 1_000,
  nowMs: 2_000,
};

describe('Posting to spectator chat', () => {
  test('a ban refuses whatever else is true', () => {
    assert({
      given: 'a banned account with no slow mode and no earlier post',
      should: 'refuse',
      actual: decideChatPost({ ...facts, banned: true, lastPostAtMs: null }),
      expected: { kind: 'banned' },
    });
  });

  test('slow mode spaces one account’s posts', () => {
    assert({
      given: 'ten-second slow mode, one second on, and exactly ten on',
      should: 'refuse with the wait, then allow',
      actual: [
        decideChatPost({ ...facts, slowModeSeconds: 10 }),
        decideChatPost({ ...facts, slowModeSeconds: 10, nowMs: 11_000 }),
      ],
      expected: [{ kind: 'slow-mode', retryAfterMs: 9_000 }, { kind: 'allowed' }],
    });
  });

  test('a first post and no slow mode are allowed', () => {
    assert({
      given: 'no earlier post under slow mode, and slow mode off',
      should: 'allow both',
      actual: [
        decideChatPost({ ...facts, slowModeSeconds: 10, lastPostAtMs: null }),
        decideChatPost(facts),
      ],
      expected: [{ kind: 'allowed' }, { kind: 'allowed' }],
    });
  });
});
