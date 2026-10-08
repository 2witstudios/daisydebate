import type { Permission } from '../sharing';

export type TeamMember = {
  readonly handle: string;
  /** A team role: Admin runs the team, Member shares into it. */
  readonly role: 'Admin' | 'Member';
};

export type SharedItem = {
  readonly id: string;
  readonly kind: 'brief' | 'card' | 'case';
  readonly title: string;
  readonly href: string;
  readonly sharedBy: string;
  readonly when: string;
  readonly permission: Permission;
};

export type ActivityEntry = {
  readonly symbol: 'comment' | 'share' | 'history';
  readonly text: string;
  readonly when: string;
};

export type Team = {
  readonly id: string;
  readonly name: string;
  /** The signed-in viewer's handle, to mark "(you)". */
  readonly viewerHandle: string;
  readonly members: readonly TeamMember[];
  readonly items: readonly SharedItem[];
  readonly activity: readonly ActivityEntry[];
  readonly pendingInvites: number;
};

export const viewerIsAdmin = (team: Team): boolean =>
  team.members.some(
    (m) => m.handle === team.viewerHandle && m.role === 'Admin',
  );
