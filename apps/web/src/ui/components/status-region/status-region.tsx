import { createElement, type ComponentPropsWithRef } from 'react';

type StatusTag = 'p' | 'span' | 'div' | 'section';
type StatusRole = 'status' | 'alert';
type StatusRegionProps<Tag extends StatusTag> = {
  readonly as: Tag;
  readonly role: StatusRole | undefined;
} & Omit<ComponentPropsWithRef<Tag>, 'role'>;

/** Keeps a status in the caller's layout and announces it at the requested priority. */
export function StatusRegion<Tag extends StatusTag>({
  as,
  role,
  ...attributes
}: StatusRegionProps<Tag>) {
  return createElement(as, { ...attributes, role });
}
