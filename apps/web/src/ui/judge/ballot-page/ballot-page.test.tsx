import { daisyBallotSource } from '@daisy/protocol/ballot-definition';
import { idle } from '../../../features/forms/form-state';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead } from '@daisy/protocol/round-ballot-read';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { postedBy } from '../../debate-room/posted-fields.test-support';
import {
  asActive,
  view,
  judge,
  aff,
  neg,
  ran,
  rules,
} from '../../debate-room/live-round.test-support';
import { attendanceSettlesAtMs } from '../../../features/round-ballots/settling';
import { sampleJudgeBallot } from '../../mock/judge.test-support';
import {
  daisyWinnerBallot,
  panelRuleFor,
} from '@daisy/protocol/ballot-definition';
setupRitewayBun();
await mockNextRouter();
const { BallotPage } = await import('./ballot-page');
const input: RoundBallotRead = {
  judging: {
    source: daisyBallotSource(daisyWinnerBallot),
    ballot: daisyWinnerBallot,
    panel: panelRuleFor(daisyWinnerBallot),
  },
  round: {
    ...asActive(view),
    participants: [
      { ...aff, label: 'Maya Singh' },
      { ...neg, label: 'Daniel Kim' },
      judge,
    ],
  },
  own: {
    participantId: judge.id,
    ballot: null,
    freezeRevision: null,
  },
  freeze: {
    revision: 1,
    frontier: 0,
    frozenAt: '2026-10-22T00:00:00.000Z',
    completeness: 'incomplete',
    utterances: [],
  },
  ballots: [],
  transcript: null,
};
const render = (state: 'waiting' | 'open' | 'submitted') =>
  renderAccessible(
    h(BallotPage, {
      view:
        state === 'waiting'
          ? { ...input, freeze: null }
          : state === 'submitted'
            ? {
                ...input,
                own: {
                  participantId: judge.id,
                  ballot: sampleJudgeBallot,
                  freezeRevision: 1,
                },
              }
            : input,
      commandId: 'c'.repeat(24),
      action: async () => idle(),
      renderedAtMs: 0,
    }),
  );
/** Whether the first element comes before the second in the document. */
const before = (first: Element, second: Element) =>
  (first.compareDocumentPosition(second) & 4) !== 0;
const slidersAt = (view: AccessibleView, value: string) =>
  view.all('slider').filter((slider) => slider.getAttribute('value') === value)
    .length;
describe('persisted BallotPage', () => {
  test('open', () => {
    const view = render('open');
    const form = view.within('form', 'Your ballot');
    const posted = postedBy(form, 'Submit ballot');
    const winner = form.all('radio');
    assert({
      given: 'an assigned judge and actual frozen input',
      should:
        'render one principal-bound native form with real names, all twenty rubric controls, reason, feedback and exact revision while reporting missing coverage honestly',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        view.count('form'),
        winner.filter((radio) => radio.getAttribute('name') === 'winner')
          .length,
        form.has('radio', 'Maya Singh Affirmative') &&
          form.has('radio', 'Daniel Kim Negative'),
        form.count('slider'),
        'reason' in posted,
        'feedback-affirmative' in posted,
        'feedback-negative' in posted,
        'conduct' in posted,
        'freezeRevision' in posted,
        'judgeParticipantId' in posted,
        view.textContent().includes('Some recorded coverage is missing'),
      ],
      expected: [1, 1, 2, true, 20, true, true, true, false, true, true, true],
    });
  });
  test('a fresh sheet', () => {
    const view = render('open');
    const posted = postedBy(view, 'Submit ballot');
    assert({
      given: 'a fresh authoritative ballot',
      should:
        'default every rubric score to3 without stale noJS totals, a selected vote or a lowpoint confirmation',
      actual: [
        slidersAt(view, '3'),
        // A total reads "Maya Singh: 30/ 50"; none renders before script runs.
        /: \d+\/ \d+/.test(view.textContent()),
        view.count('radio', undefined, { checked: true }),
        view.textContent().includes('No winner picked'),
        'low-point' in posted,
      ],
      expected: [20, false, 0, false, false],
    });
  });
  test('not frozen yet', () => {
    const view = render('waiting');
    assert({
      given: 'an actual judge before input freeze',
      should:
        'wait for immutable recorded input and offer a refresh without a ballot or a demo-state link',
      actual: [
        view
          .textContent()
          .includes('opens when the recorded transcript is frozen'),
        view.count('form') + view.count('button'),
        view.has('link', 'Refresh Round'),
        view.textContent().includes('Demo:'),
      ],
      expected: [true, 0, true, false],
    });
  });
  test('submitted', () => {
    const view = render('submitted');
    const text = view.textContent();
    assert({
      given: 'an actual stored own ballot while another vote is pending',
      should:
        'show stored vote without a second form or fabricated final outcome',
      actual: [
        text.includes('Ballot submitted'),
        text.includes(
          'once any other ballots and attendance for the last speeches settle',
        ),
        view.count('form') + view.count('button'),
        view.has('region', 'Your recorded ballot'),
        text.includes('Round outcome:'),
      ],
      expected: [true, true, 0, true, false],
    });
  });
});

describe('a ballot opened before attendance settles', () => {
  const round = {
    ...ran(rules.length, true),
    participants: input.round.participants,
  };
  const settles = attendanceSettlesAtMs(round)!;
  const at = (renderedAtMs: number) =>
    renderAccessible(
      h(BallotPage, {
        view: { ...input, round },
        commandId: 'c'.repeat(24),
        action: async () => idle(),
        renderedAtMs,
      }),
    );

  test('12 seconds before it settles', () => {
    const view = at(settles - 12_000);
    const text = view.textContent();
    assert({
      given: 'the frozen transcript 12 seconds before attendance settles',
      should:
        'say when submitting opens and that entries are kept, above the full ballot whose Submit still posts before hydration',
      actual: [
        text.includes('Submitting opens in about 12 seconds.'),
        text.includes(
          `until ${new Date(settles).toISOString().slice(11, 19)} UTC`,
        ),
        text.includes('nothing you enter is lost'),
        view.count('slider'),
        view.get('button', 'Submit ballot').hasAttribute('disabled'),
      ],
      expected: [true, true, true, 20, false],
    });
  });

  test('once it has settled', () => {
    assert({
      given: 'the same ballot rendered after attendance settles',
      should: 'show no waiting notice',
      actual: at(settles + 1_000)
        .textContent()
        .includes('Submitting opens'),
      expected: false,
    });
  });
});

describe('BallotPage, how the ballot works', () => {
  test('said up front, with the window’s time left', () => {
    const view = renderAccessible(
      h(BallotPage, {
        view: {
          ...input,
          round: {
            ...input.round,
            waitingOn: {
              state: 'human_window',
              deadlineAt: new Date(30 * 60_000).toISOString(),
            },
          },
        },
        commandId: 'c'.repeat(24),
        action: async () => idle(),
        renderedAtMs: 60_000,
      }),
    );
    const rules = view.within('region', 'How this ballot works').textContent();
    const open = [
      before(
        view.get('region', 'How this ballot works'),
        view.get('form', 'Your ballot'),
      ),
      rules.includes('There are no draws.'),
      rules.includes('up to 600 characters'),
      rules.includes('up to 280 characters'),
      rules.includes('30 minutes from when your ballot opens'),
      view.has('timer', 'Time left to submit 29:00'),
      view.textContent().includes('What a 1, 3 and 5 look like'),
    ];
    const waiting = render('waiting').has('region', 'How this ballot works');
    const submitted = render('submitted').has(
      'region',
      'How this ballot works',
    );
    assert({
      given:
        'an open ballot a minute into its window, a waiting one and a submitted one',
      should:
        'state the rules and the time left before the form, while waiting too, and not once submitted',
      actual: [...open, waiting, submitted],
      expected: [true, true, true, true, true, true, true, true, false],
    });
  });
});
