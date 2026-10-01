import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptySummary,
  isFirstVisit,
  weekGoalMet,
  weekSessions,
  type TrainingSummary,
} from './summary';

setupRitewayBun();

const trained: TrainingSummary = {
  ...emptySummary,
  sessions: 12,
  week: {
    days: [true, false, true, true, false, false, false],
    goal: 3,
    practicedDaysLast30: 12,
  },
};

describe('training summary', () => {
  test('first visit', () => {
    assert({
      given: 'an account with no sessions and one with twelve',
      should: 'call only the first a first visit',
      actual: [isFirstVisit(emptySummary), isFirstVisit(trained)],
      expected: [true, false],
    });
  });

  test('week progress', () => {
    assert({
      given: 'three trained days against a goal of three, and an empty week',
      should: 'count the days and meet the goal only with a goal set',
      actual: [
        weekSessions(trained),
        weekGoalMet(trained),
        weekGoalMet({ ...trained, week: { ...trained.week, goal: 5 } }),
        weekGoalMet(emptySummary),
      ],
      expected: [3, true, false, false],
    });
  });
});
