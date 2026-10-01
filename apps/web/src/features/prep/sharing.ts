export type Permission = 'view' | 'comment' | 'edit';

export const permissionLabel: Readonly<Record<Permission, string>> = {
  view: 'Can view',
  comment: 'Can comment',
  edit: 'Can edit',
};

export const permissions: readonly Permission[] = ['view', 'comment', 'edit'];

/** A team or a person a brief is shared with. */
export type Grant = {
  readonly id: string;
  readonly kind: 'team' | 'person';
  readonly name: string;
  readonly detail: string;
  readonly permission: Permission;
  /** Initials for the avatar stack. */
  readonly initials: readonly string[];
};

type CommentReply = {
  readonly author: string;
  readonly when: string;
  readonly body: string;
};

export type CommentThread = {
  readonly id: string;
  readonly author: string;
  readonly when: string;
  /** What the comment is about: "Contention 1, warrant". */
  readonly anchor: string;
  readonly body: string;
  readonly resolved: boolean;
  readonly replies: readonly CommentReply[];
};

/** Everything about who can see one brief, and what they have said about it. */
export type ShareRecord = {
  readonly briefId: string;
  readonly grants: readonly Grant[];
  readonly includeCards: boolean;
  readonly threads: readonly CommentThread[];
};

/** What happens when a team or person is typed into the add row. */
export type ShareTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-a-member'; readonly teamName: string }
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'ready';
      readonly name: string;
      readonly permission: Permission;
    };

export const openCount = (threads: readonly CommentThread[]): number =>
  threads.filter((thread) => !thread.resolved).length;

const resolvedCount = (threads: readonly CommentThread[]): number =>
  threads.filter((thread) => thread.resolved).length;

/** "2 open · 1 resolved". */
export const threadSummary = (threads: readonly CommentThread[]): string =>
  `${openCount(threads)} open · ${resolvedCount(threads)} resolved`;
