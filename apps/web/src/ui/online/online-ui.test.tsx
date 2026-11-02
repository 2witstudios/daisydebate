import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { OnlineMember, OnlineRoster } from '@daisy/protocol';
import { ratingsLabel, ratingText } from './member-card';
import { OnlineProvider } from './online-provider';
import { OnlineRail } from './online-rail';
import { rowDetail } from './online-rows';
import { canBeChallenged } from './person-menu';
import { StatusForm } from './status-form';

setupRitewayBun();

const noop = () => {};
const router = {
  bfcacheId: 'test',
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};
const action = async () => ({});
const actions = {
  friend: async () => ({ username: '' }),
  sendChallenge: action,
  acceptChallenge: action,
  endChallenge: action,
  message: async () => ({
    requestId: '',
    recipients: '',
    title: '',
    introduction: '',
  }),
  report: action,
  block: action,
};
const person = (over: Partial<OnlineMember> = {}): OnlineMember => ({
  username: 'ada',
  status: 'online',
  relation: 'none',
  ratings: [
    { ladder: 'freestyle', rating: 1612, provisional: true, hidden: false },
  ],
  wins: 3,
  losses: 1,
  ...over,
});
const roster = (members: readonly OnlineMember[]): OnlineRoster => ({
  version: 1,
  members: [...members],
  nextCursor: null,
  counts: { everyone: members.length, friends: 0 },
  self: 'online',
});
const inProvider = (children: unknown, members: readonly OnlineMember[]) =>
  renderToString(
    h(
      AppRouterContext,
      { value: router },
      h(OnlineProvider, {
        initialRoster: roster(members),
        initialChallenges: {
          version: 1,
          incoming: [
            {
              id: 'c'.repeat(24),
              username: 'mara',
              mode: 'ranked',
              format: 'freestyle',
              createdAt: '2026-11-02T00:00:00.000Z',
              expiresAt: '2026-11-02T00:02:00.000Z',
            },
          ],
          outgoing: [],
          accepted: [],
        },
        actorId: null,
        socketUrl: null,
        children: children as never,
      }),
    ),
  );

describe('the online rail', () => {
  const html = inProvider(
    h(OnlineRail, {
      preference: 'auto',
      actions,
      setRail: async () => {},
      activeRoomId: null,
    }),
    [
      person(),
      person({ username: 'bea', relation: 'friends', status: 'round' }),
    ],
  );
  test('a row works before any script', () => {
    assert({
      given: 'the server-rendered rail',
      should: 'link each row and its three dots to the profile, friends first',
      actual: [
        html.includes('href="/profile/ada"'),
        html.includes('aria-label="Actions for @ada"'),
        html.indexOf('@bea') < html.indexOf('@ada'),
        html.includes('name="rail"'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('a row carries no action button of its own', () => {
    assert({
      given: 'a row',
      should:
        'keep Challenge and Add friend in the menu, so the rail stays narrow',
      actual: [
        html.includes('>Challenge</button>'),
        html.includes('Add friend'),
      ],
      expected: [false, false],
    });
  });
  test('an incoming challenge shows with both answers', () => {
    assert({
      given: 'a waiting challenge',
      should: 'name who and what, and offer Accept and Decline',
      actual: [
        html.includes('Challenge from @mara'),
        html.includes('Freestyle · Ranked'),
        html.includes('>Accept<'),
        html.includes('>Decline<'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('a screen reader hears the same ratings as anyone', () => {
    assert({
      given: 'a member showing only Freestyle',
      should: 'name only that rating',
      actual: ratingsLabel(person()),
      expected: 'Freestyle Provisional',
    });
  });
});

describe('row words', () => {
  test('a sent offer or request reads over the status', () => {
    assert({
      given: 'a sent challenge, a sent request, and neither',
      should: 'say so, else the status',
      actual: [
        rowDetail(person(), true),
        rowDetail(person({ relation: 'outgoing' }), false),
        rowDetail(person({ status: 'room' }), false),
      ],
      expected: ['Challenge sent', 'Friend request sent', 'In a room'],
    });
  });
  test('ratings read as figures or the shared words', () => {
    assert({
      given: 'established, provisional, unplayed and blinded',
      should: 'read as the account menu does',
      actual: [
        ratingText({
          ladder: 'policy',
          rating: 1500,
          provisional: false,
          hidden: false,
        }),
        ratingText({
          ladder: 'policy',
          rating: 1500,
          provisional: true,
          hidden: false,
        }),
        ratingText({
          ladder: 'policy',
          rating: null,
          provisional: false,
          hidden: false,
        }),
        ratingText({
          ladder: 'policy',
          rating: null,
          provisional: false,
          hidden: true,
        }),
      ],
      expected: ['1500', 'Provisional', 'Unrated', 'Hidden while judging'],
    });
  });
});

describe('canBeChallenged', () => {
  test('only someone free', () => {
    assert({
      given: 'each status a row can show',
      should: 'allow online and away only',
      actual: (['online', 'away', 'busy', 'room', 'round'] as const).map(
        (status) => canBeChallenged(person({ status })),
      ),
      expected: [true, true, false, false, false],
    });
  });
});

describe('StatusForm', () => {
  test('one native button per choice, the current one pressed', () => {
    const html = renderToString(h(StatusForm, { action, chosen: 'busy' }));
    assert({
      given: 'a member who chose Busy',
      should: 'post each status as a button value, with Busy pressed',
      actual: [
        html.includes('value="online"'),
        html.includes('value="offline"'),
        /value="busy"[^>]*aria-pressed="true"/.test(html),
        html.includes('Appear offline'),
      ],
      expected: [true, true, true, true],
    });
  });
});
