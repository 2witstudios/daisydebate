import type { RoomView } from '@daisy/protocol';
import { refused, type FormState } from '../forms/form-state';

type CommandAction = (state: FormState, form: FormData) => Promise<FormState>;

type Consent = {
  readonly readSnapshot: () => {
    readonly devicesPassed: boolean;
    readonly pending: boolean;
    readonly view: Pick<RoomView, 'prep' | 'resolutionDraw'>;
  };
  readonly ready: () => Promise<void>;
  readonly unready: () => Promise<void>;
};
/** Local device consent fences Ready/Launch only; CAP still authorizes every command. */
export function createLocalCommandAction(
  consent: Consent,
  action: CommandAction,
): CommandAction {
  return async (state, form) => {
    const type = form.get('type');
    const local = consent.readSnapshot();
    if (type === 'ready' && (local.pending || !local.devicesPassed))
      return refused(form, 'Check your current devices before Ready.');
    if (type === 'ready' || type === 'unready') {
      await (type === 'ready' ? consent.ready() : consent.unready());
      return { values: {} };
    }
    const committed =
      local.view.prep.startedAt !== null || local.view.resolutionDraw !== null;
    if (
      type === 'start-round' &&
      !committed &&
      (local.pending || !local.devicesPassed)
    )
      return refused(form, 'Confirm your current readiness before Launch.');
    return action(state, form);
  };
}
