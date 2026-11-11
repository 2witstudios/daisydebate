import {
  idle,
  refused,
  type Done,
  type Idle,
  type Refused,
} from './form-state';

/** The answer of a settings form that saves in place: the page stays, and says so. */
export type SaveFormState = Idle | Refused | Done;

export const initialSaveForm: SaveFormState = idle();

/** Not saved, whether the server refused or the post never reached it. */
export const saveRefused = (form: FormData): Refused =>
  refused(form, 'Could not save. Try again.');

/** What the form says beside Save, if anything. */
export function saveNotice(answer: SaveFormState): string | undefined {
  switch (answer.kind) {
    case 'idle':
      return undefined;
    case 'refused':
      return answer.error;
    case 'done':
      return 'Saved.';
  }
}
