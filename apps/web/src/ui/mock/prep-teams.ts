import type { Team } from '../../features/prep/team';
import type { ShareRecord } from '../../features/prep/sharing';
import { sampleTeamName } from './prep';

export const sampleTeams: readonly Team[] = [
  {
    id: 'sample-team',
    name: sampleTeamName,
    viewerHandle: 'debater-a',
    members: [
      { handle: 'debater-a', role: 'Admin' },
      { handle: 'debater-b', role: 'Member' },
      { handle: 'debater-c', role: 'Member' },
      { handle: 'debater-d', role: 'Member' },
    ],
    items: [
      {
        id: 'tp-a',
        kind: 'case',
        title: 'Affirmative, rights-based',
        href: '/prep/cases/aff-rights',
        sharedBy: 'You',
        when: '2 days ago',
        permission: 'comment',
      },
      {
        id: 'tp-b',
        kind: 'brief',
        title: 'Affirmative case: rights-based framework',
        href: '/prep/briefs/rights-framework',
        sharedBy: 'You',
        when: '2 days ago',
        permission: 'comment',
      },
      {
        id: 'tp-c',
        kind: 'brief',
        title: 'Opening statements, [Motion B]',
        href: '/prep/briefs/opening-statements',
        sharedBy: '@debater-b',
        when: 'Last week',
        permission: 'edit',
      },
      {
        id: 'tp-d',
        kind: 'card',
        title: 'Cost estimates depend on assumed take-up',
        href: '/prep/cards/cost-estimates',
        sharedBy: 'You',
        when: 'Last week',
        permission: 'view',
      },
      {
        id: 'tp-e',
        kind: 'card',
        title: 'Sources on enforcement',
        href: '/prep/cards/enforcement-sources',
        sharedBy: '@debater-d',
        when: '3 weeks ago',
        permission: 'view',
      },
    ],
    activity: [
      {
        symbol: 'comment',
        text: '@debater-b commented on Affirmative, rights-based',
        when: '2 hours ago',
      },
      {
        symbol: 'share',
        text: 'You shared Cost estimates depend on assumed take-up',
        when: 'Last week',
      },
      {
        symbol: 'history',
        text: '@debater-b saved v2 of Opening statements',
        when: '3 weeks ago',
      },
    ],
    pendingInvites: 2,
  },
];

/** Teams the viewer is not in: sharing with one is refused. */
export const strangerTeamNames: readonly string[] = ['[Other team]'];

export const sampleShares: readonly ShareRecord[] = [
  {
    briefId: 'rights-framework',
    includeCards: true,
    grants: [
      {
        id: 'p-team',
        kind: 'team',
        name: sampleTeamName,
        detail: 'Team · 4 members',
        permission: 'comment',
        initials: ['A', 'B', 'C'],
      },
      {
        id: 'p-d',
        kind: 'person',
        name: '@debater-d',
        detail: 'Individual',
        permission: 'view',
        initials: ['D'],
      },
    ],
    threads: [
      {
        id: 't1',
        author: '@debater-b',
        when: '2 hours ago',
        anchor: 'Contention 1, warrant',
        body: 'The second sentence moves from “institutions” to “persons” without a bridge. Can a card carry it?',
        resolved: false,
        replies: [
          {
            author: 'You',
            when: '1 hour ago',
            body: 'Adding a card from [Author C] here.',
          },
        ],
      },
      {
        id: 't2',
        author: '@debater-d',
        when: 'Yesterday',
        anchor: 'Framing',
        body: 'Weighing reads clearly. Resolved after the edit.',
        resolved: true,
        replies: [],
      },
    ],
  },
];
