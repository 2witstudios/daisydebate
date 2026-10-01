'use client';

import {
  drillUnavailable,
  type DrillState,
} from '../../../features/train/drill';
import type { DrillScreen } from '../../../features/train/drill-view';
import { useFormAction } from '../../form-action/form-action';
import { renderDrillForm } from './drill-form.render';

/** The drill's server action: the next state for a posted form. */
export type DrillAction = (
  state: DrillState,
  form: FormData,
) => Promise<DrillState>;

/**
 * The drill form. It posts to a server action, so check, revise and save work
 * before hydration and with no script; script only adds the pending state and
 * keeps the text if the post never reaches the server.
 */
export function DrillForm({
  action,
  initial,
  screen,
}: {
  readonly action: DrillAction;
  readonly initial: DrillState;
  readonly screen: DrillScreen;
}) {
  const [state, post, pending] = useFormAction(
    action,
    initial,
    drillUnavailable,
  );
  return renderDrillForm({ state, screen, pending, post });
}
