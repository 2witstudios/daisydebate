import type { RoomView } from '@daisy/protocol';

type RoomVisibility = RoomView['visibility'];

/**
 * A Room is public unless its host chooses otherwise (owner, 2026-11-10).
 * Every surface that picks a visibility nobody chose takes this one; unlisted
 * and private are explicit casual choices. The ranked lock is separate: a
 * ranked Room is always public, whatever this default says.
 */
export const defaultRoomVisibility = 'public' satisfies RoomVisibility;

/** Who can join, in words: one home for every surface that names it. */
export const roomVisibilityLabels = {
  public: 'Listed in the lobby',
  unlisted: 'Anyone with the link',
  private: 'Invite only',
} as const satisfies Record<RoomVisibility, string>;

/**
 * What a host may choose, in the order it is offered: public first. Private
 * returns with an invite path (ISSUE-443).
 */
export const roomVisibilityChoices = [
  {
    value: defaultRoomVisibility,
    label: roomVisibilityLabels[defaultRoomVisibility],
    detail: 'anyone can find and join it',
  },
  {
    value: 'unlisted',
    label: roomVisibilityLabels.unlisted,
    detail: 'only people you share the link with',
  },
] as const satisfies readonly {
  readonly value: RoomVisibility;
  readonly label: string;
  readonly detail: string;
}[];
