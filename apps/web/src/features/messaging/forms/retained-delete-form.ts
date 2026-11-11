import {
  idle,
  refusedWith,
  type Idle,
  type Moved,
  type Refused,
} from '../../forms/form-state';

/** What deleting a retained conversation answers: a refusal, or the move to Messages. */
export type RetainedDeleteState = Idle | Refused | Moved;

export const initialRetainedDelete: RetainedDeleteState = idle();
export const retainedDeleteRefused: Refused = refusedWith(
  {},
  'Could not delete this conversation. Try again.',
);
/** The form is one button, so a lost post keeps nothing. */
export const retainedDeleteUnavailable = (): Refused =>
  refusedWith({}, 'Could not reach Daisy. Try again.');

/** What the button says beside itself, if anything. */
export function retainedDeleteNotice(
  answer: RetainedDeleteState,
): string | undefined {
  switch (answer.kind) {
    case 'idle':
    case 'moved':
      return undefined;
    case 'refused':
      return answer.error;
  }
}
