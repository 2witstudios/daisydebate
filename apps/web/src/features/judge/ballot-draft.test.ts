import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotDraftKey,
  ballotDraftOf,
  clearBallotDraft,
  parseBallotDraft,
  storedBallotDraft,
  writeBallotDraft,
  type BallotDraftStorage,
} from './ballot-draft';

setupRitewayBun();

const memory = (): BallotDraftStorage & {
  readonly items: Map<string, string>;
} => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
};
const refusing: BallotDraftStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('full');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};
const key = ballotDraftKey('round-1', 'seat-1');
const readBallotDraft = (storage: BallotDraftStorage, at: string) =>
  parseBallotDraft(storedBallotDraft(storage, at));

describe('ballot draft', () => {
  test('a round trip keeps only the ballot’s own fields', () => {
    const storage = memory();
    writeBallotDraft(storage, key, {
      winner: 'negative',
      reason: 'Clearer weighing.',
      'feedback-affirmative': 'Slow down.',
      commandId: 'c1',
      expectedVersion: '4',
      $ACTION_ID_x: '',
    });
    assert({
      given: 'a form’s values with its command envelope',
      should: 'restore the picks and text and drop the envelope',
      actual: readBallotDraft(storage, key),
      expected: {
        winner: 'negative',
        reason: 'Clearer weighing.',
        'feedback-affirmative': 'Slow down.',
      },
    });
  });

  test('removal, garbage and refused storage', () => {
    const storage = memory();
    writeBallotDraft(storage, key, { winner: 'affirmative' });
    clearBallotDraft(storage, key);
    const garbled = memory();
    garbled.setItem(key, '[1,2]');
    const notJson = memory();
    notJson.setItem(key, '{');
    assert({
      given: 'a removed draft, a non-object, invalid JSON and refused storage',
      should: 'read none of them and never throw',
      actual: [
        readBallotDraft(storage, key),
        readBallotDraft(garbled, key),
        readBallotDraft(notJson, key),
        readBallotDraft(refusing, key),
        (writeBallotDraft(refusing, key, { winner: 'negative' }),
        clearBallotDraft(refusing, key),
        'kept going'),
      ],
      expected: [null, null, null, null, 'kept going'],
    });
  });

  test('each judge seat in each Round has its own draft', () => {
    assert({
      given: 'two Rounds and two seats',
      should: 'key each draft apart',
      actual: new Set([
        ballotDraftKey('r1', 's1'),
        ballotDraftKey('r2', 's1'),
        ballotDraftKey('r1', 's2'),
      ]).size,
      expected: 3,
    });
  });

  test('a draft written on the earlier rubric is never read into the current form', () => {
    const storage = memory();
    // What a tab on the speaker-10@1 build stored for this seat.
    const earlier = 'daisy:ballot-draft:speaker-10@1:round-1:seat-1';
    storage.setItem(earlier, JSON.stringify({ winner: 'negative' }));
    assert({
      given: 'a speaker-10@1 draft stored for the same Round and seat',
      should: 'read no draft under the current rubric’s key',
      actual: [
        key.includes(':speaker-10@2:'),
        readBallotDraft(storage, earlier),
        readBallotDraft(storage, key),
      ],
      expected: [true, { winner: 'negative' }, null],
    });
  });

  test('an over-long value is not kept', () => {
    assert({
      given: 'a reason far beyond any ballot limit',
      should: 'drop it',
      actual: ballotDraftOf({ reason: 'x'.repeat(5000), winner: 'negative' }),
      expected: { winner: 'negative' },
    });
  });
});
