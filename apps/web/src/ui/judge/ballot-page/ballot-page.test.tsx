import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundBallotRead } from '@daisy/protocol';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import {
  view,
  judge,
  aff,
  neg,
} from '../../debate-room/live-round.test-support';
import { sampleJudgeBallot } from '../../mock/judge';
setupRitewayBun();
await mockNextRouter();
const { BallotPage } = await import('./ballot-page');
const input: RoundBallotRead = {
  round: {
    ...view,
    status: 'active',
    participants: [
      { ...aff, label: 'Maya Singh' },
      { ...neg, label: 'Daniel Kim' },
      judge,
    ],
  },
  own: {
    participantId: judge.id,
    status: null,
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
  coaching: null,
};
const render = (state: 'waiting' | 'open' | 'submitted') =>
  renderToString(
    h(BallotPage, {
      view:
        state === 'waiting'
          ? { ...input, freeze: null }
          : state === 'submitted'
            ? {
                ...input,
                own: {
                  participantId: judge.id,
                  status: 'submitted',
                  ballot: sampleJudgeBallot,
                  freezeRevision: 1,
                },
              }
            : input,
      commandId: 'c'.repeat(24),
      action: async () => ({ values: {} }),
    }),
  );
const count = (html: string, pattern: RegExp) =>
  (html.match(pattern) ?? []).length;
describe('persisted BallotPage', () => {
  test('open', () => {
    const html = render('open');
    assert({
      given: 'an assigned judge and actual frozen input',
      should:
        'render one principal-bound native form with real names, all twenty rubric controls, reason, feedback and exact revision while reporting missing coverage honestly',
      actual: [
        count(html, /<h1 /g),
        count(html, /<form/g),
        count(html, /name="winner"/g),
        html.includes('Maya Singh') && html.includes('Daniel Kim'),
        count(html, /type="range"/g),
        html.includes('name="reason"'),
        html.includes('name="feedback-affirmative"'),
        html.includes('name="feedback-negative"'),
        html.includes('name="conduct"'),
        html.includes('name="freezeRevision"'),
        html.includes('name="judgeParticipantId"'),
        html.includes('Submit ballot'),
        html.includes('Some recorded coverage is missing'),
      ],
      expected: [
        1,
        1,
        2,
        true,
        20,
        true,
        true,
        true,
        false,
        true,
        true,
        true,
        true,
      ],
    });
  });
  test('a fresh sheet', () => {
    const html = render('open');
    assert({
      given: 'a fresh authoritative ballot',
      should:
        'default every rubric score to3 without stale noJS totals, a selected vote or a lowpoint confirmation',
      actual: [
        count(html, /type="range"[^>]*value="3"/g),
        count(html, />30</g),
        html.includes('No winner picked'),
        html.includes('name="low-point"'),
      ],
      expected: [20, 0, false, false],
    });
  });
  test('not frozen yet', () => {
    const html = render('waiting');
    assert({
      given: 'an actual judge before input freeze',
      should:
        'wait for immutable recorded input and offer a refresh without a ballot or a demo-state link',
      actual: [
        html.includes('opens when the recorded transcript is frozen'),
        html.includes('<form'),
        html.includes('Refresh Round'),
        html.includes('Demo:'),
      ],
      expected: [true, false, true, false],
    });
  });
  test('submitted', () => {
    const html = render('submitted');
    assert({
      given: 'an actual stored own ballot while another vote is pending',
      should:
        'show stored vote without a second form or fabricated final outcome',
      actual: [
        html.includes('Ballot submitted'),
        html.includes('Other votes or attendance settlement are still pending'),
        html.includes('<form'),
        html.includes('Your recorded ballot'),
        html.includes('Round outcome:'),
      ],
      expected: [true, true, false, true, false],
    });
  });
});
