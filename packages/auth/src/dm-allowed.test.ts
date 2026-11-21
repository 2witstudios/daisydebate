import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ageBands, messageRequestSettings } from '@daisy/protocol';
import { dmAllowed, dmRequestOffer, type DmQuestion } from './social-policy';
import { adultAccount } from './social.test-support';
setupRitewayBun();

const stages = ['request', 'conversation'] as const;
const flags = [false, true] as const;
/** Every question the rule can be asked: the full matrix. */
const matrix: readonly DmQuestion[] = stages.flatMap((stage) =>
  ageBands.flatMap((initiator) =>
    ageBands.flatMap((recipient) =>
      flags.flatMap((friends) =>
        flags.flatMap((linkedStaff) =>
          messageRequestSettings.map((recipientSetting) => ({
            stage,
            initiator,
            recipient,
            friends,
            linkedStaff,
            recipientSetting,
          })),
        ),
      ),
    ),
  ),
);
const where = (keep: (question: DmQuestion) => boolean) => matrix.filter(keep);
const answers = (questions: readonly DmQuestion[]) =>
  questions.map((question) => dmAllowed(question));
const all = (value: boolean, questions: readonly DmQuestion[]) =>
  questions.map(() => value);
const minor = (band: DmQuestion['initiator']) =>
  band === '13-15' || band === '16-17';
const plain = {
  friends: false,
  linkedStaff: false,
  recipientSetting: 'everyone',
} as const;

describe('dmAllowed (decision 90)', () => {
  test('the matrix is total', () =>
    assert({
      given: 'every stage, band pair, friendship, staff link and setting',
      should: 'answer each of the 576 questions with a boolean',
      actual: [
        matrix.length,
        matrix.every((question) => typeof dmAllowed(question) === 'boolean'),
      ],
      expected: [2 * 4 * 4 * 2 * 2 * 3, true],
    }));

  test('under 13 is always refused', () => {
    const questions = where(
      (q) => q.initiator === 'under-13' || q.recipient === 'under-13',
    );
    assert({
      given: 'any question with an under-13 party',
      should: 'refuse it',
      actual: answers(questions),
      expected: all(false, questions),
    });
  });

  test('a new request honours the recipient setting first', () => {
    const none = where(
      (q) => q.stage === 'request' && q.recipientSetting === 'none',
    );
    const friendsOnlyStrangers = where(
      (q) =>
        q.stage === 'request' && q.recipientSetting === 'friends' && !q.friends,
    );
    assert({
      given: 'a recipient who takes requests from no one, or from friends only',
      should: 'refuse every request from anyone else, linked staff included',
      actual: [...answers(none), ...answers(friendsOnlyStrangers)],
      expected: all(false, [...none, ...friendsOnlyStrangers]),
    });
  });

  test('the setting never ends an existing conversation', () => {
    const conversations = where((q) => q.stage === 'conversation');
    assert({
      given: 'the same conversation under each recipient setting',
      should: 'answer the same whatever the setting',
      actual: conversations.map((q) => dmAllowed(q)),
      expected: conversations.map((q) =>
        dmAllowed({ ...q, recipientSetting: 'everyone' }),
      ),
    });
  });

  test('peers and a minor asking an adult need no relation', () => {
    const peersOrMinorFirst = where(
      (q) =>
        q.initiator !== 'under-13' &&
        q.recipient !== 'under-13' &&
        (minor(q.initiator) || q.recipient === 'adult') &&
        (q.stage === 'conversation' || q.recipientSetting === 'everyone'),
    );
    assert({
      given:
        'adult to adult, minor to minor (13-15 and 16-17 in any mix), or a minor asking an adult',
      should: 'allow it with no friendship or staff link',
      actual: answers(peersOrMinorFirst),
      expected: all(true, peersOrMinorFirst),
    });
  });

  test('an adult reaches a minor only through friendship or their staff link', () => {
    const adultToMinor = where(
      (q) =>
        q.initiator === 'adult' &&
        minor(q.recipient) &&
        (q.stage === 'conversation' || q.recipientSetting === 'everyone'),
    );
    assert({
      given: 'an adult asking, or posting to, a 13-15 or 16-17',
      should:
        'allow it exactly when they are friends or the adult is linked staff',
      actual: answers(adultToMinor),
      expected: adultToMinor.map((q) => q.friends || q.linkedStaff),
    });
  });

  test('named cases from the owner direction', () =>
    assert({
      given: 'the cases decision 90 names',
      should: 'answer each as the owner said',
      actual: [
        // 14 to 16: a message request, straight to the recipient.
        dmAllowed({
          stage: 'request',
          initiator: '13-15',
          recipient: '16-17',
          ...plain,
        }),
        // An adult's cold request to a 14-year-old.
        dmAllowed({
          stage: 'request',
          initiator: 'adult',
          recipient: '13-15',
          ...plain,
        }),
        // After the 14-year-old accepts the friendship.
        dmAllowed({
          stage: 'request',
          initiator: 'adult',
          recipient: '13-15',
          ...plain,
          friends: true,
        }),
        // The minor's own club staff, directly.
        dmAllowed({
          stage: 'request',
          initiator: 'adult',
          recipient: '16-17',
          ...plain,
          linkedStaff: true,
        }),
        // A minor asks an adult.
        dmAllowed({
          stage: 'request',
          initiator: '16-17',
          recipient: 'adult',
          ...plain,
        }),
        // Unfriended: the adult's DM with the minor stops posting.
        dmAllowed({
          stage: 'conversation',
          initiator: 'adult',
          recipient: '13-15',
          ...plain,
        }),
        // A minor's own DM with an adult keeps posting without a friendship.
        dmAllowed({
          stage: 'conversation',
          initiator: '13-15',
          recipient: 'adult',
          ...plain,
        }),
        // Adult to adult under Friends only, as friends.
        dmAllowed({
          stage: 'request',
          initiator: 'adult',
          recipient: 'adult',
          ...plain,
          friends: true,
          recipientSetting: 'friends',
        }),
      ],
      expected: [true, false, true, true, true, false, true, true],
    }));
});

describe('dmRequestOffer', () => {
  const now = '2026-10-09T00:00:00.000Z';
  const person = (
    actorId: string,
    band: '13-15' | 'adult',
    contact: Partial<{
      requestSetting: 'everyone' | 'friends' | 'none';
      friendActorIds: readonly string[];
      linkedAdultUserIds: readonly string[];
    }> = {},
  ) => {
    const row = adultAccount(actorId);
    return {
      account: { ...row.account, ageBand: band },
      age: { ...row.age, band },
      contact: { ...row.contact, ...contact },
    };
  };
  test('what the profile offers', () =>
    assert({
      given:
        'an adult toward a minor, a Friends-only adult, a No-one adult, friends, linked staff and peers',
      should:
        'offer Add friend wherever only a friendship opens a request, so an age never shows',
      actual: [
        dmRequestOffer(
          [person('a', 'adult'), person('b', '13-15')],
          now,
          'a',
          'b',
        ),
        dmRequestOffer(
          [
            person('a', 'adult'),
            person('b', 'adult', { requestSetting: 'friends' }),
          ],
          now,
          'a',
          'b',
        ),
        dmRequestOffer(
          [
            person('a', 'adult'),
            person('b', 'adult', { requestSetting: 'none' }),
          ],
          now,
          'a',
          'b',
        ),
        dmRequestOffer(
          [
            person('a', 'adult', { friendActorIds: ['b'] }),
            person('b', '13-15', { friendActorIds: ['a'] }),
          ],
          now,
          'a',
          'b',
        ),
        dmRequestOffer(
          [
            person('a', 'adult'),
            person('b', '13-15', { linkedAdultUserIds: ['a'] }),
          ],
          now,
          'a',
          'b',
        ),
        dmRequestOffer(
          [person('a', '13-15'), person('b', 'adult')],
          now,
          'a',
          'b',
        ),
        dmRequestOffer(
          [person('a', 'adult'), person('b', 'adult')],
          now,
          'a',
          'b',
        ),
        dmRequestOffer([person('a', 'adult')], now, 'a', 'b'),
      ],
      expected: [
        'befriend',
        'befriend',
        'none',
        'message',
        'message',
        'message',
        'message',
        'none',
      ],
    }));
});

describe('dmAllowed with guardian protection', () => {
  test('a friends-only lock governs new requests without closing conversations', () =>
    assert({
      given:
        'a managed minor receiving a request from a linked adult who is not a friend',
      should: 'refuse the new request and preserve an accepted conversation',
      actual: stages.map((stage) =>
        dmAllowed({
          ...plain,
          stage,
          initiator: 'adult',
          recipient: '13-15',
          linkedStaff: true,
          protectedMessageRequests: 'friends',
        }),
      ),
      expected: [false, true],
    }));
});
