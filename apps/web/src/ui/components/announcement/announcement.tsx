import { createElement, type ComponentPropsWithRef } from 'react';

type AnnouncementTag = 'p' | 'span' | 'div' | 'section';

/**
 * What an announcement says, which decides how it is spoken:
 * - `progress`: the state of something the member did or is waiting on
 *   (saved, sending, three people joined). It waits for the screen reader
 *   to finish (role=status).
 * - `problem`: something failed or needs the member now (it did not save,
 *   the room closed). It interrupts (role=alert).
 */
export type AnnouncementKind = 'progress' | 'problem';

const roleOf = {
  progress: 'status',
  problem: 'alert',
} as const satisfies Record<AnnouncementKind, 'status' | 'alert'>;

type AnnouncementProps<Tag extends AnnouncementTag> = {
  readonly as: Tag;
  readonly kind: AnnouncementKind;
} & Omit<ComponentPropsWithRef<Tag>, 'role' | 'aria-live' | 'aria-atomic'>;

/**
 * A live region in the caller's layout. It owns how its text is announced:
 * the caller says what kind of thing it is, never which role to use.
 * Both roles are atomic, so a change re-reads the whole message.
 */
export function Announcement<Tag extends AnnouncementTag>({
  as,
  kind,
  ...attributes
}: AnnouncementProps<Tag>) {
  return createElement(as, { ...attributes, role: roleOf[kind] });
}
