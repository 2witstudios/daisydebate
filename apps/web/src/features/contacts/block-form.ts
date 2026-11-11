import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { singleFormField } from '../../server/form-field';
import {
  idle,
  refusedWith,
  type Idle,
  type Refused,
} from '../forms/form-state';

/** The two fields the block form posts and shows again. */
export type BlockValues = {
  readonly requestId: string;
  readonly username: string;
};

type BlockIdle = Idle & { readonly values: BlockValues };
type BlockRefused = Refused & { readonly values: BlockValues };

/** The contact was blocked or unblocked; `values.requestId` is new, for the next post. */
export type BlockChanged = {
  readonly kind: 'changed';
  readonly values: BlockValues;
  readonly notice: string;
};

/** What the block-by-username form's action answers. */
export type BlockFormState = BlockIdle | BlockRefused | BlockChanged;

export const initialBlockForm = (requestId: string): BlockFormState => ({
  kind: 'idle',
  values: { requestId, username: '' },
});

export const blockChanged = (
  values: BlockValues,
  blocked: boolean,
): BlockChanged => ({
  kind: 'changed',
  values,
  notice: blocked ? 'Contact blocked.' : 'Contact unblocked.',
});

/** What the block form renders: its fields and the notice beside them. */
export type BlockFields = BlockValues & { readonly notice: string | undefined };

export function blockFields(answer: BlockFormState): BlockFields {
  switch (answer.kind) {
    case 'idle':
      return { ...answer.values, notice: undefined };
    case 'refused':
      return { ...answer.values, notice: answer.error };
    case 'changed':
      return { ...answer.values, notice: answer.notice };
  }
}
/** The native block form's one command: a username and the choice. */
export function parseBlockForm(input: unknown) {
  if (!(input instanceof FormData)) throw createAppError('VALIDATION');
  const read = (key: string) => singleFormField(input, key);
  const requestId = idSchema.safeParse(read('requestId'));
  const decision = read('decision');
  if (!requestId.success || !['block', 'unblock'].includes(decision))
    throw createAppError('VALIDATION');
  return {
    version: 1 as const,
    requestId: requestId.data,
    username: read('username'),
    blocked: decision === 'block',
  };
}
export function blockFormUnavailable(input: FormData): BlockRefused {
  const username = input.get('username');
  return {
    kind: 'refused',
    values: {
      requestId:
        typeof input.get('requestId') === 'string'
          ? String(input.get('requestId'))
          : '',
      username: typeof username === 'string' ? username : '',
    },
    error: 'Could not change this contact. Your username is kept; try again.',
  };
}

/** The people list's one-button block: its answer, and whether to close. */
export type PersonBlockState = Idle | Refused | { readonly kind: 'blocked' };

export const initialPersonBlock: PersonBlockState = idle();
export const personBlocked: PersonBlockState = { kind: 'blocked' };
/** A failed call says to try again; the form is one button, so nothing is lost. */
export const personBlockUnavailable = (): PersonBlockState =>
  refusedWith({}, 'Could not block them. Try again.');

/** What the button says beside itself, if anything. */
export function personBlockNotice(
  answer: PersonBlockState,
): string | undefined {
  switch (answer.kind) {
    case 'idle':
      return undefined;
    case 'refused':
      return answer.error;
    case 'blocked':
      return 'Blocked.';
  }
}
