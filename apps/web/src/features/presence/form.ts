import type { ChosenStatus } from '@daisy/protocol';
import {
  idle,
  refusedWith,
  type Idle,
  type Refused,
} from '../forms/form-state';

/** The status was changed to `status`. */
export type PresenceSet = {
  readonly kind: 'set';
  readonly status: ChosenStatus;
};

/** What the member's own status form answers. */
export type PresenceFormState = Idle | Refused | PresenceSet;

export const initialPresenceForm: PresenceFormState = idle();

export const presenceSet = (status: ChosenStatus): PresenceSet => ({
  kind: 'set',
  status,
});

/** A failed call says to try again; the choice is three buttons, so nothing is lost. */
export const presenceFormUnavailable = (): PresenceFormState =>
  refusedWith({}, 'Could not change your status. Try again.');

/** What the status form renders: the status the answer set, if it set one, and its refusal. */
export type PresenceFields = {
  readonly status: ChosenStatus | undefined;
  readonly notice: string | undefined;
};

export function presenceFields(answer: PresenceFormState): PresenceFields {
  switch (answer.kind) {
    case 'idle':
      return { status: undefined, notice: undefined };
    case 'refused':
      return { status: undefined, notice: answer.error };
    case 'set':
      return { status: answer.status, notice: undefined };
  }
}
