import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingViewer } from './audience';
import {
  mayTakeDownYouthRecording,
  recordingAudience,
  youthRoundPublishable,
  type YouthRoundPeople,
} from './youth-audience';

setupRitewayBun();

const youth: YouthRoundPeople = {
  debaters: [
    { actorId: 'aff', userId: 'user-aff', linkedAdultActorIds: ['coach'] },
    { actorId: 'neg', userId: 'user-neg', linkedAdultActorIds: ['parent'] },
  ],
};
const round = {
  seatedActorIds: ['aff', 'neg', 'judge'],
  officialActorIds: ['judge'],
  youth,
};
const account = (actorId: string): RecordingViewer => ({
  kind: 'account',
  userId: `user-${actorId}`,
  actorId,
});

describe('recordingAudience', () => {
  test('admits the Round and its linked adults only', () => {
    assert({
      given: 'a debater, a judge, a coach, a parent, a stranger and a visitor',
      should: 'admit the first four, each by what they are, and deny the rest',
      actual: [
        account('aff'),
        account('judge'),
        account('coach'),
        account('parent'),
        account('stranger'),
        { kind: 'visitor' } as const,
      ].map((viewer) => recordingAudience(round, viewer)),
      expected: [
        { kind: 'allowed', as: 'debater' },
        { kind: 'allowed', as: 'judge' },
        { kind: 'allowed', as: 'linked_adult' },
        { kind: 'allowed', as: 'linked_adult' },
        { kind: 'denied', reason: 'not_in_audience' },
        { kind: 'denied', reason: 'signed_out' },
      ],
    });
  });

  test('a host who did not sit is not in the audience', () => {
    assert({
      given: 'the Room’s host, not seated and linked to nobody',
      should: 'deny',
      actual: recordingAudience(round, account('host')),
      expected: { kind: 'denied', reason: 'not_in_audience' },
    });
  });
});

describe('youthRoundPublishable', () => {
  test('needs an active release from every youth debater', () => {
    assert({
      given: 'no releases, one, one withdrawn, and both active',
      should: 'be publishable only with both active',
      actual: [
        youthRoundPublishable(youth, []),
        youthRoundPublishable(youth, [
          { subjectUserId: 'user-aff', scope: 'publish', withdrawnAt: null },
        ]),
        youthRoundPublishable(youth, [
          { subjectUserId: 'user-aff', scope: 'publish', withdrawnAt: null },
          {
            subjectUserId: 'user-neg',
            scope: 'publish',
            withdrawnAt: '2026-11-01T00:00:00.000Z',
          },
        ]),
        youthRoundPublishable(youth, [
          { subjectUserId: 'user-aff', scope: 'publish', withdrawnAt: null },
          { subjectUserId: 'user-neg', scope: 'publish', withdrawnAt: null },
        ]),
      ],
      expected: [false, false, false, true],
    });
  });

  test('a judge’s release is not needed and not enough', () => {
    assert({
      given: 'a release from the judge alone',
      should: 'not publish',
      actual: youthRoundPublishable(youth, [
        { subjectUserId: 'user-judge', scope: 'publish', withdrawnAt: null },
      ]),
      expected: false,
    });
  });

  test('nobody to release is never publishable', () => {
    assert({
      given: 'a Youth Round with no youth debater on record',
      should: 'not publish',
      actual: youthRoundPublishable({ debaters: [] }, []),
      expected: false,
    });
  });
});

describe('mayTakeDownYouthRecording', () => {
  const may = (
    viewer: RecordingViewer,
    status: 'ready' | 'removing' = 'ready',
  ) => mayTakeDownYouthRecording({ round, viewer, status });

  test('any youth debater or linked adult, never a judge or stranger', () => {
    assert({
      given: 'each debater, a coach, a parent, the judge and a stranger',
      should: 'let the debaters and linked adults take it down',
      actual: ['aff', 'neg', 'coach', 'parent', 'judge', 'stranger'].map(
        (actorId) => may(account(actorId)),
      ),
      expected: [true, true, true, true, false, false],
    });
  });

  test('a judge who is also a linked adult still may not', () => {
    assert({
      given: 'the Round’s judge, who is also a debater’s parent',
      should: 'offer no takedown',
      actual: mayTakeDownYouthRecording({
        round: {
          ...round,
          youth: {
            debaters: [
              {
                actorId: 'aff',
                userId: 'user-aff',
                linkedAdultActorIds: ['judge'],
              },
            ],
          },
        },
        viewer: account('judge'),
        status: 'ready',
      }),
      expected: false,
    });
  });

  test('nothing to take down', () => {
    assert({
      given: 'a Recording already going, no Recording, and a visitor',
      should: 'offer no takedown',
      actual: [
        may(account('aff'), 'removing'),
        mayTakeDownYouthRecording({
          round,
          viewer: account('aff'),
          status: null,
        }),
        may({ kind: 'visitor' }),
      ],
      expected: [false, false, false],
    });
  });
});
