import type { ComponentPropsWithRef } from 'react';

type DialogProps =
  | ({ readonly as?: 'dialog' } & ComponentPropsWithRef<'dialog'>)
  | ({ readonly as: 'section' } & ComponentPropsWithRef<'section'>)
  | ({ readonly as: 'div' } & ComponentPropsWithRef<'div'>);

/** Renders the native dialog or the labelled shell of a feature-managed overlay. */
export function Dialog(props: DialogProps) {
  if (props.as === 'section') {
    const { as: Shell, ...attributes } = props;
    return <Shell {...attributes} role="dialog" />;
  }
  if (props.as === 'div') {
    const { as: Shell, ...attributes } = props;
    return <Shell {...attributes} role="dialog" />;
  }
  const { as: NativeDialog = 'dialog', ...attributes } = props;
  return <NativeDialog {...attributes} />;
}
