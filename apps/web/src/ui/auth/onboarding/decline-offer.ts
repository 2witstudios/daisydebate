import {
  idle,
  type Idle,
  type Moved,
} from '../../../features/forms/form-state';

/**
 * What the passkey offer's decline choices answer: nothing until posted,
 * then where the server sent the account on to.
 */
export type DeclineState = Idle | Moved;

export const initialDecline: DeclineState = idle();

/**
 * A posted decline whose call never reached the server, because the
 * browser's call to the action failed in transport. Nothing was declined
 * yet, so the choices simply unlock again.
 */
export const declineUnavailable = (): DeclineState => initialDecline;
