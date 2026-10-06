import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomInfo } from '../rooms/view';
import { parseDebateQuery, type DebateQuery } from './state';
import { getRoundBallots } from '../judge/get-ballots';
import { debateView, type DebateView } from './view';

setupRitewayBun();

const info: RoomInfo = {
  id: 'demo',
  title: 'Evening round',
  mode: 'practice',
  hostHandle: 'host-two',
  judge: 'person',
};
const view = (change: Partial<DebateQuery> = {}) =>
  debateView(info, { ...parseDebateQuery({}), ...change });

/** The one-line reason a ruling without ballots gives, if it gives one. */
const reasonOf = (v: DebateView): string | null =>
  v.kind === 'completed' && v.ruling.kind === 'reason' ? v.ruling.reason : null;

describe('debateView', () => {
  test('a live turn', () => {
    const v = view();
    assert({
      given: 'the affirmative speech in progress, seen by a debater',
      should: 'show the turn, the time left and what comes next',
      actual: [
        v.kind,
        v.kind === 'live' && v.now.label,
        v.kind === 'live' && v.now.remaining,
        v.kind === 'live' && v.now.yours,
        v.kind === 'live' && v.next,
      ],
      expected: [
        'live',
        'Affirmative speech',
        '2:42',
        true,
        'Next: Negative speech, 4:00',
      ],
    });
  });

  test('a prep turn', () => {
    const v = view({ turn: 1 });
    assert({
      given: 'the prep turn',
      should: 'be prep for both sides, and nobody’s turn to speak',
      actual: [
        v.kind === 'live' && v.now.label,
        v.kind === 'live' && v.now.side,
        v.kind === 'live' && v.now.yours,
      ],
      expected: ['Prep time', 'both', false],
    });
  });

  test('the timeline marks done, now and next', () => {
    const v = view({ turn: 3 });
    assert({
      given: 'the negative speech in progress',
      should: 'mark earlier turns done and later ones next',
      actual: v.kind === 'live' && v.timeline.map((row) => row.state),
      expected: ['done', 'done', 'now', 'next', 'next'],
    });
  });

  test('awaiting a person judge', () => {
    const asDebater = view({ turn: 6 });
    const asJudge = view({ turn: 6, viewer: 'judge' });
    assert({
      given: 'the speaking over, a person judging',
      should: 'give the judge a link to the ballot and the debater only a note',
      actual: [
        asDebater.kind === 'awaiting' && asDebater.action,
        asJudge.kind === 'awaiting' && asJudge.action?.href,
        asDebater.kind === 'awaiting' &&
          asDebater.note.includes('Waiting for the judge'),
      ],
      expected: [null, '/judge/ballot/demo', true],
    });
  });

  test('awaiting the AI judge', () => {
    const v = view({ turn: 6, judgeKind: 'ai' });
    assert({
      given: 'the speaking over, the AI judge judging',
      should: 'let a debater ask for the ruling and say it is a placeholder',
      actual: [
        v.kind === 'awaiting' && v.action?.label,
        v.kind === 'awaiting' && v.note.includes('placeholder'),
      ],
      expected: ['Ask the AI judge', true],
    });
  });

  test('a ruling', () => {
    const v = view({ turn: 6, judgeKind: 'ai', ruledBy: 'ai' });
    assert({
      given: 'the AI judge has ruled',
      should:
        'name a winner, say it chose at random and link to the room and a rematch',
      actual: [
        v.kind,
        v.kind === 'completed' &&
          ['affirmative', 'negative'].includes(v.winner),
        reasonOf(v)?.includes('chose at random'),
        v.kind === 'completed' && v.rematchHref?.startsWith('/rooms/demo?'),
      ],
      expected: ['completed', true, true, true],
    });
  });

  test('a person’s ruling carries both ballots', () => {
    const ballots = getRoundBallots(info.id);
    const ruled = {
      turn: 6,
      judgeKind: 'person' as const,
      ruledBy: 'person' as const,
    };
    const person = debateView(
      info,
      { ...parseDebateQuery({}), ...ruled },
      ballots,
    );
    const unread = view(ruled);
    const ai = debateView(
      info,
      { ...parseDebateQuery({}), turn: 6, judgeKind: 'ai', ruledBy: 'ai' },
      ballots,
    );
    const ballotsOf = (v: DebateView) =>
      v.kind === 'completed' && v.ruling.kind === 'ballots'
        ? v.ruling.ballots
        : null;
    assert({
      given:
        'a debate a person judged with its ballots read, one whose ballots are not read, and one only the AI judge ruled',
      should:
        'take the winner from the person’s ballot and show both ballots, and fall back to a one-line reason otherwise',
      actual: [
        person.kind === 'completed' && person.winner,
        ballotsOf(person)?.judge === ballots?.judge,
        ballotsOf(person)?.ai.rubricVersion,
        reasonOf(person),
        ballotsOf(unread),
        reasonOf(unread) !== null,
        ballotsOf(ai),
        reasonOf(ai)?.includes('chose at random'),
      ],
      expected: [
        'affirmative',
        true,
        'speaker-10@1',
        null,
        null,
        true,
        null,
        true,
      ],
    });
  });

  test('an outsider', () => {
    assert({
      given: 'a viewer who is not in the debate',
      should: 'be refused, naming nothing about it',
      actual: view({ viewer: 'outsider' }),
      expected: { kind: 'denied', lobbyHref: '/lobby' },
    });
  });

  test('a recorded result from history', () => {
    const history = {
      ...info,
      id: 'd-ladder-climb',
      fromHistory: true as const,
    };
    const result = (win: 'affirmative' | 'negative' | 'draw') =>
      debateView(history, {
        turn: 6,
        judgeKind: 'person',
        viewer: 'debater',
        ruledBy: 'person',
        outcome: win,
      });
    const [lost, draw] = [result('affirmative'), result('draw')];
    assert({
      given:
        'a finished debate known only from history, recorded as a win and a draw',
      should:
        'show the recorded winner, explain a draw, and offer no room or rematch',
      actual: [
        lost.kind === 'completed' && lost.winner,
        draw.kind === 'completed' && draw.winner,
        reasonOf(draw)?.includes('level'),
        lost.kind === 'completed' && lost.rematchHref,
        lost.kind === 'completed' && lost.roomHref,
      ],
      expected: ['affirmative', 'draw', true, null, null],
    });
  });
});
