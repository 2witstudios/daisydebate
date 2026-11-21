import type { ReactNode } from 'react';
import type { CommandAction } from '../../../features/tab/action';
import {
  ReplayCommandForm,
  type ReplayCommandAction,
} from '../../form-action/replay-command-form';

/** Bind the projected command at the server edge and retain its identity on retry. */
export function CommandControl<Command>({
  action,
  bind,
  children,
}: {
  readonly action: CommandAction<Command>;
  readonly bind: (command: Command) => ReplayCommandAction;
  readonly children: ReactNode;
}) {
  return (
    <ReplayCommandForm
      label={action.label}
      submitLabel={action.label}
      action={bind(action.command)}
    >
      {children}
    </ReplayCommandForm>
  );
}
