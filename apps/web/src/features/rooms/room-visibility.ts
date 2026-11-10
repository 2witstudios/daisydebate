import type { RoomView } from '@daisy/protocol';

/**
 * A Room is public unless its host chooses otherwise (owner, 2026-11-10).
 * Every surface that picks a visibility nobody chose takes this one; unlisted
 * and private are explicit casual choices, and ranked is always public.
 */
export const defaultRoomVisibility = 'public' satisfies RoomView['visibility'];

/**
 * What a host may choose, in the order it is offered: public first. Private
 * returns with an invite path (ISSUE-443).
 */
export const roomVisibilityChoices = [
  {
    value: defaultRoomVisibility,
    label: 'Listed in the lobby',
    detail: 'anyone can find and join it',
  },
  {
    value: 'unlisted',
    label: 'Anyone with the link',
    detail: 'only people you share the link with',
  },
] as const satisfies readonly {
  readonly value: RoomView['visibility'];
  readonly label: string;
  readonly detail: string;
}[];
