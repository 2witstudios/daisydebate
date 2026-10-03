import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockOpponent } from '../../ui/mock/train-practice';
import { liveView, type SpeechView } from './live';
import { liveLinks, parseLiveQuery, unavailableLinks } from './live-links';
import { defaultConfig } from './practice';
import { defaultHubQuery } from './query';

setupRitewayBun();

const at = (seq: number): SpeechView => {
  const view = liveView(defaultConfig, 'aff', seq, mockOpponent);
  if (view?.kind !== 'speech') throw new Error('expected a speech');
  return view;
};

describe('parseLiveQuery', () => {
  test('defaults and values', () => {
    assert({
      given: 'nothing, then a turn with the hint and end confirmation',
      should: 'start at turn 1, then read each',
      actual: [
        parseLiveQuery({}),
        parseLiveQuery({ turn: '3', hint: '1', confirm: 'end' }),
        parseLiveQuery({ turn: 'x', confirm: 'yes' }),
      ],
      expected: [
        { seq: 1, hint: false, confirmEnd: false },
        { seq: 3, hint: true, confirmEnd: true },
        { seq: 1, hint: false, confirmEnd: false },
      ],
    });
  });
});

describe('liveLinks', () => {
  const plan = { ...defaultHubQuery, did: ['review'] } as const;

  test('mid-debate', () => {
    const links = liveLinks(defaultConfig, plan, at(2), {
      seq: 2,
      hint: false,
      confirmEnd: false,
    });
    assert({
      given: 'turn 2 with review done',
      should:
        'link the next turn, the hint, the end flow and the problem report',
      actual: links,
      expected: {
        leave: '/train/progress?did=review',
        hint: '/train/practice/live?turn=2&hint=1&did=review',
        next: {
          href: '/train/practice/live?turn=3&did=review',
          label: 'End speech',
        },
        askEnd: '/train/practice/live?turn=2&confirm=end&did=review',
        keepGoing: '/train/practice/live?turn=2&did=review',
        endNow: '/train/practice/debrief?upto=2&did=review',
        reportProblem: '/train/practice/unavailable?turn=2&did=review',
      },
    });
  });

  test('your own speech has nothing to report', () => {
    assert({
      given: 'turn 1, which is yours',
      should: 'offer no problem report',
      actual: liveLinks(defaultConfig, defaultHubQuery, at(1), {
        seq: 1,
        hint: false,
        confirmEnd: false,
      }).reportProblem,
      expected: null,
    });
  });

  test('the hint link hides an open hint', () => {
    assert({
      given: 'the hint already open',
      should: 'link back to the turn without it',
      actual: liveLinks(defaultConfig, defaultHubQuery, at(1), {
        seq: 1,
        hint: true,
        confirmEnd: false,
      }).hint,
      expected: '/train/practice/live?turn=1',
    });
  });

  test('the last turn finishes into the debrief', () => {
    assert({
      given: 'turn 5',
      should: 'finish and see the whole debrief',
      actual: liveLinks(defaultConfig, defaultHubQuery, at(5), {
        seq: 5,
        hint: false,
        confirmEnd: false,
      }).next,
      expected: {
        href: '/train/practice/debrief',
        label: 'Finish and see debrief',
      },
    });
  });

  test('config rides along', () => {
    assert({
      given: 'a Neg practice',
      should: 'keep the side in links',
      actual: liveLinks(
        { ...defaultConfig, side: 'neg' },
        defaultHubQuery,
        at(1),
        { seq: 1, hint: false, confirmEnd: false },
      ).keepGoing,
      expected: '/train/practice/live?side=neg&turn=1',
    });
  });
});

describe('unavailableLinks', () => {
  test('try again, continue solo, end', () => {
    assert({
      given: 'the opponent unavailable on turn 2',
      should:
        'retry the turn, continue solo from it, or end with earlier speeches',
      actual: unavailableLinks(defaultConfig, defaultHubQuery, 2),
      expected: {
        leave: '/train/progress',
        tryAgain: '/train/practice/live?turn=2',
        continueSolo: '/train/practice/live?opp=solo&turn=2',
        end: '/train/practice/debrief?upto=2',
      },
    });
  });
});
