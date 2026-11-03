import type { AudienceSnapshot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { newerAudience } from './newer-audience';

setupRitewayBun();

const roundId = createId();
const message = (sequence: number, text: string | null = 'A line') => ({
  id: createId(),
  sequence,
  at: '2026-11-03T12:00:00.000Z',
  author: 'someone',
  text,
});
const view = (
  messages: AudienceSnapshot['messages'],
  viewers: number | null = null,
): AudienceSnapshot => ({
  version: 1,
  roundId,
  interaction: 'open',
  messages,
  reactions: [],
  viewers,
});

describe('newerAudience', () => {
  test('a read behind the newest message shown waits', () => {
    const shown = view([message(1), message(2)]);
    assert({
      given: 'a cached read that has not reached the poster’s own message',
      should: 'keep what is on screen',
      actual: newerAudience(shown, view([message(1)])),
      expected: shown,
    });
  });

  test('a read that has caught up replaces the view', () => {
    const removed = view([message(1), message(2, null)], 4);
    assert({
      given: 'the same newest message, now removed, and a count',
      should: 'show the removal and the count, since moderation must take hold',
      actual: newerAudience(view([message(1), message(2)]), removed),
      expected: removed,
    });
  });
});
