import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingViewer } from './audience';
import {
  mayTakeDownYouthRecording,
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

  test('a Recording moderation hid may still be asked for', () => {
    assert({
      given: 'a youth debater asking while a report keeps it taken down',
      should: 'accept, so the removal is owed when the report closes',
      actual: mayTakeDownYouthRecording({
        round,
        viewer: account('aff'),
        status: 'taken_down',
      }),
      expected: true,
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
