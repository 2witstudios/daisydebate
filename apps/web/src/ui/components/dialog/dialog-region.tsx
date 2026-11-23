import type { ComponentPropsWithRef } from 'react';

type DialogRegionProps =
  | ({ readonly as: 'section' } & ComponentPropsWithRef<'section'>)
  | ({ readonly as: 'div' } & ComponentPropsWithRef<'div'>);

/**
 * The labelled shell of an overlay whose showing another primitive owns (a
 * popover, a sheet): it carries the dialog role and nothing else.
 */
export function DialogRegion(props: DialogRegionProps) {
  if (props.as === 'section') {
    const { as: Shell, ...attributes } = props;
    return <Shell {...attributes} role="dialog" />;
  }
  const { as: Shell, ...attributes } = props;
  return <Shell {...attributes} role="dialog" />;
}
