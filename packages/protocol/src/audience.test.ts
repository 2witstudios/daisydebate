import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import {
  audienceSnapshotSchema,
  notificationKinds,
  SPECTATOR_CHAT_UNITS,
  spectatorChatPostSchema,
  viewerPulseSchema,
} from './audience';

setupRitewayBun();

const post = (text: string) =>
  spectatorChatPostSchema.safeParse({
    version: 1,
    requestId: createId(),
    text,
  }).success;

describe('spectator chat post', () => {
  test('bounds the text', () => {
    assert({
      given: 'a blank message, one at the limit and one past it',
      should: 'refuse the blank and the long one, never truncating',
      actual: [
        post('  \n'),
        post('x'.repeat(SPECTATOR_CHAT_UNITS)),
        post('x'.repeat(SPECTATOR_CHAT_UNITS + 1)),
      ],
      expected: [false, true, false],
    });
  });
});

describe('viewer pulse', () => {
  test('carries nothing but its token', () => {
    assert({
      given: 'a pulse that names an account',
      should: 'refuse it, so no identity can enter a count',
      actual: viewerPulseSchema.safeParse({
        version: 1,
        token: createId(),
        userId: createId(),
      }).success,
      expected: false,
    });
  });
});

describe('audience snapshot', () => {
  test('has no field an outcome could travel in', () => {
    assert({
      given: 'a snapshot with a winner beside the audience facts',
      should: 'refuse it',
      actual: audienceSnapshotSchema.safeParse({
        version: 1,
        roundId: createId(),
        interaction: 'open',
        messages: [],
        reactions: [],
        viewers: null,
        winner: 'affirmative',
      }).success,
      expected: false,
    });
  });
});

describe('notification kinds', () => {
  test('are the two accepted kinds', () => {
    assert({
      given: 'the accepted WATCH-12 design',
      should: 'name a followed debater going live and a Recording being ready',
      actual: notificationKinds,
      expected: ['followed_debater_live', 'recording_ready'],
    });
  });
});
