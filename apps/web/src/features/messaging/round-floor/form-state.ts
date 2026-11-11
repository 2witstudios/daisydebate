import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import type {
  FormValues,
  Idle,
  Refused,
  Unacknowledged,
} from '../../forms/form-state';

/** The draft a floor form holds and the request its command posts under. */
type FloorDraft = {
  readonly values: { readonly text: string; readonly requestId: string };
};
export type FloorIdle = Idle & FloorDraft;
export type FloorRefused = Refused & FloorDraft;
/**
 * The answer was lost, so the command may have committed. `values` are the
 * fields of that original command, which alone may be posted again until an
 * answer arrives; `error` says so.
 */
export type FloorUnacknowledged = Unacknowledged & { readonly error: string };
/** A message was sent or reported; `requestId` is the next command's. */
export type FloorSent = {
  readonly kind: 'sent';
  readonly messageId: string;
  readonly requestId: string;
};
/**
 * A message was edited or removed. `text` is what it now says (nothing once
 * removed) at `changeVersion`; `requestId` is the next command's.
 */
export type FloorChanged = {
  readonly kind: 'changed';
  readonly messageId: string;
  readonly requestId: string;
  readonly text: string;
  readonly changeVersion: number;
};

/** A Round floor form's answer; the forms stay on the Round and never move on. */
export type FloorFormState =
  FloorIdle | FloorRefused | FloorUnacknowledged | FloorSent | FloorChanged;

export const floorIdle = (requestId: string, text = ''): FloorIdle => ({
  kind: 'idle',
  values: { text, requestId },
});
export const floorRefused = (
  values: FloorDraft['values'],
  error: string,
): FloorRefused => ({ kind: 'refused', values, error });
export const floorUnacknowledged = (
  values: FormValues,
  error: string,
): FloorUnacknowledged => ({ kind: 'unacknowledged', values, error });
export const floorSent = (messageId: string, requestId: string): FloorSent => ({
  kind: 'sent',
  messageId,
  requestId,
});
export const floorChanged = (
  messageId: string,
  requestId: string,
  text: string,
  changeVersion: number,
): FloorChanged => ({
  kind: 'changed',
  messageId,
  requestId,
  text,
  changeVersion,
});

/** The fields that make a floor command what it is; a retry must repeat each. */
const commandFields = ['requestId', 'messageId', 'kind', 'text', 'reason'];

const unacknowledgedShape = z.object({
  kind: z.literal('unacknowledged'),
  values: z.record(z.string(), z.unknown()),
});

/** The named text fields `read` yields, which is all a floor command is made of. */
function commandOf(read: (name: string) => unknown): FormValues {
  const values: Record<string, string> = {};
  for (const name of commandFields) {
    const value = read(name);
    if (typeof value === 'string') values[name] = value;
  }
  return values;
}

/** The command a posted floor form carries, as the fields a retry repeats. */
export const floorCommand = (form: FormData): FormValues =>
  commandOf((name) => form.get(name));

/**
 * The command a previous answer left unacknowledged, or null. The previous
 * answer returns from the browser, so its shape is checked, not assumed.
 */
export function unacknowledgedFloorCommand(
  previous: unknown,
): FormValues | null {
  const parsed = unacknowledgedShape.safeParse(previous);
  if (!parsed.success) return null;
  const command = commandOf((name) => parsed.data.values[name]);
  return idSchema.safeParse(command.requestId).success ? command : null;
}

export const sameFloorCommand = (left: FormValues, right: FormValues) =>
  commandFields.every((name) => left[name] === right[name]);

/** What a floor form's controls render from each answer. */
export type FloorFields = {
  readonly text: string;
  readonly requestId: string;
  readonly notice: string | undefined;
  /** The original command must be retried unchanged before anything else. */
  readonly retrying: boolean;
};

export function floorFields(answer: FloorFormState): FloorFields {
  switch (answer.kind) {
    case 'idle':
      return { ...answer.values, notice: undefined, retrying: false };
    case 'refused':
      return { ...answer.values, notice: answer.error, retrying: false };
    case 'unacknowledged':
      return {
        text: answer.values.text ?? '',
        requestId: answer.values.requestId ?? '',
        notice: answer.error,
        retrying: true,
      };
    case 'sent':
      return {
        text: '',
        requestId: answer.requestId,
        notice: undefined,
        retrying: false,
      };
    case 'changed':
      return {
        text: answer.text,
        requestId: answer.requestId,
        notice: undefined,
        retrying: false,
      };
  }
}

/** The message an accepted answer is about, or undefined when none was accepted. */
export function floorAcceptedMessage(
  answer: FloorFormState,
): string | undefined {
  switch (answer.kind) {
    case 'sent':
    case 'changed':
      return answer.messageId;
    case 'idle':
    case 'refused':
    case 'unacknowledged':
      return undefined;
  }
}
