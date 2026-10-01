import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import type { ActivityEntry, SharedItem, Team, TeamMember } from './team';
import { viewerIsAdmin } from './team';

const tabs = ['items', 'members', 'activity'] as const;
export type TeamTab = (typeof tabs)[number];

export type TeamQuery = { readonly tab: TeamTab };

const schema = z.object({ tab: z.enum(tabs).catch('items') });

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export const parseTeamQuery = (params: SearchParams): TeamQuery =>
  schema.parse({ tab: first(params['tab']) });

export const teamHref = (id: string, tab: TeamTab): string =>
  tab === 'items' ? `/prep/teams/${id}` : `/prep/teams/${id}?tab=${tab}`;

const tabLabels: Readonly<Record<TeamTab, string>> = {
  items: 'Shared items',
  members: 'Members',
  activity: 'Activity',
};

export type TeamView = {
  readonly team: Team;
  readonly tab: TeamTab;
  readonly tabs: readonly {
    id: TeamTab;
    label: string;
    href: string;
    count?: number;
  }[];
  readonly items: readonly (SharedItem & {
    readonly subtitle: string;
    readonly canChange: boolean;
  })[];
  readonly members: readonly (TeamMember & {
    readonly label: string;
    readonly isViewer: boolean;
  })[];
  readonly activity: readonly ActivityEntry[];
  readonly isAdmin: boolean;
  readonly pendingLine: string;
};

/** The team page's driver: a team and the tab in the URL to a view model. */
export function teamView(team: Team, query: TeamQuery): TeamView {
  const isAdmin = viewerIsAdmin(team);
  return {
    team,
    tab: query.tab,
    tabs: tabs.map((id) => ({
      id,
      label: tabLabels[id],
      href: teamHref(team.id, id),
      ...(id === 'items' ? { count: team.items.length } : {}),
      ...(id === 'members' ? { count: team.members.length } : {}),
    })),
    items: team.items.map((item) => ({
      ...item,
      subtitle: `Shared by ${item.sharedBy} · ${item.when}`,
      canChange: item.sharedBy === 'You',
    })),
    members: team.members.map((member) => {
      const isViewer = member.handle === team.viewerHandle;
      return {
        ...member,
        isViewer,
        label: `@${member.handle}${isViewer ? ' (you)' : ''}`,
      };
    }),
    activity: team.activity,
    isAdmin,
    pendingLine: `${team.pendingInvites} ${team.pendingInvites === 1 ? 'invitation' : 'invitations'} pending. Invitations expire after [7] days.`,
  };
}
