import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { Person, PeopleList } from '@daisy/protocol/people-list';
import type { RatingDivision } from '@daisy/protocol/ladder';
import { initialChallengeForm } from '../../features/challenges/forms';
import { initialPersonBlock } from '../../features/contacts/block-form';
import { initialFriendForm } from '../../features/friends/forms';
import { creationIdle } from '../../features/messaging/forms/create-form';
import { initialReportForm } from '../../features/reports/form';
import { ChallengeProvider } from '../challenges/challenge-provider';
import { PeopleProvider } from './people-provider';
import { PeopleRail } from './people-rail';

/**
 * Test support: the people rail and its providers, unrendered, for the role
 * reads in people-ui.test.tsx and the rail's markup contract.
 */
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
const actions = {
  friend: async () => initialFriendForm(),
  sendChallenge: async () => initialChallengeForm,
  acceptChallenge: async () => initialChallengeForm,
  endChallenge: async () => initialChallengeForm,
  message: async () => creationIdle(''),
  report: async () => initialReportForm,
  block: async () => initialPersonBlock,
};
export const person = (over: Partial<Person> = {}): Person => ({
  username: 'ada',
  displayName: null,
  photoId: null,
  status: 'online',
  relation: 'none',
  ratings: [
    {
      ladder: { style: 'freestyle', division: 'open' },
      rating: null,
      provisional: false,
      hidden: false,
    },
    {
      ladder: { style: 'freestyle', division: 'youth' },
      rating: 1612,
      provisional: true,
      hidden: false,
    },
  ],
  division: 'youth',
  challengeModes: ['ranked', 'casual'],
  wins: 3,
  losses: 1,
  ...over,
});
const list = (people: readonly Person[]): PeopleList => ({
  version: 1,
  people: [...people],
  nextCursor: null,
  counts: { everyone: people.length + 7, friends: 3, online: people.length },
  self: 'online',
});
/** The rail's providers around `children`, with one incoming challenge from @mara. */
const inProviders = (
  children: unknown,
  people: readonly Person[],
  memberDivision: RatingDivision | null = 'youth',
) =>
  h(
    AppRouterContext,
    { value: router },
    h(PeopleProvider, {
      initialList: list(people),
      socketUrl: null,
      children: h(ChallengeProvider, {
        memberDivision,
        initialChallenges: {
          version: 1,
          incoming: [
            {
              id: 'c'.repeat(24),
              actorId: 'm'.repeat(24),
              username: 'mara',
              mode: 'ranked',
              format: 'freestyle',
              lobbyId: 'l'.repeat(24),
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
    }),
  );

/** The rail as the app shell places it, in its providers. */
export const rail = (
  people: readonly Person[],
  memberDivision: RatingDivision | null = 'youth',
) =>
  inProviders(
    h(PeopleRail, {
      preference: 'auto',
      actions,
      setRail: async () => {},
      activeRoomId: null,
    }),
    people,
    memberDivision,
  );
