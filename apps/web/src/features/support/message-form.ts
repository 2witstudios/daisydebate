import {
  supportMessageLimits,
  supportMessageSchema,
  type SupportMessage,
} from '@daisy/protocol/support-message';
import {
  formValues,
  idle,
  refusedWith,
  type FormValues,
  type Idle,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';

/**
 * The /support form (SUPP-1): its fields, the one pure rule that reads them,
 * and the answers its action gives.
 */
export const messageFieldNames = [
  'messageId',
  'topic',
  'message',
  'about',
  'replyEmail',
] as const;
export type MessageField = (typeof messageFieldNames)[number];

/**
 * The spam trap: a field people never see or fill. A post that fills it gets
 * the ordinary confirmation, and nothing is stored or sent.
 */
export const honeypotField = 'website';

export type MessageValues = Readonly<Record<MessageField, string>>;
export type FieldErrors = Readonly<Partial<Record<MessageField, string>>>;

/** The form as first filled: a signed-in member's reply address is theirs to keep or change. */
export const blankMessage = (
  messageId: string,
  replyEmail: string,
): MessageValues => ({
  messageId,
  topic: 'problem',
  message: '',
  about: '',
  replyEmail,
});

const fieldMessages: Readonly<Record<MessageField, string>> = {
  messageId: 'This form has expired. Reload the page and send it again.',
  topic: 'Choose what this is about.',
  message: `Write your message, up to ${supportMessageLimits.message.toLocaleString('en-US')} characters.`,
  about: `Keep this to one line of ${supportMessageLimits.about} characters.`,
  replyEmail: 'Enter an email address we can reply to.',
};

/** How one posted form reads: a message to send, a trap to ignore, or what to fix. */
export type MessageReading =
  | { readonly kind: 'accepted'; readonly message: SupportMessage }
  | { readonly kind: 'trapped' }
  | { readonly kind: 'incomplete'; readonly errors: FieldErrors };

const isMessageField = (key: PropertyKey): key is MessageField =>
  (messageFieldNames as readonly PropertyKey[]).includes(key);

/** The form's own fields from whatever was posted; anything missing reads as empty. */
export const messageValuesOf = (values: FormValues): MessageValues =>
  Object.fromEntries(
    messageFieldNames.map((name) => [name, values[name] ?? '']),
  ) as MessageValues;

/**
 * The one rule for a support message: total and pure. A filled trap wins
 * over everything; otherwise each field the protocol refuses gets its own
 * message.
 */
export function supportMessageOf(values: FormValues): MessageReading {
  if ((values[honeypotField] ?? '').trim() !== '') return { kind: 'trapped' };
  const parsed = supportMessageSchema.safeParse({
    v: 1,
    ...messageValuesOf(values),
  });
  if (parsed.success) return { kind: 'accepted', message: parsed.data };
  const errors: Partial<Record<MessageField, string>> = {};
  for (const issue of parsed.error.issues) {
    const [name] = issue.path;
    if (name !== undefined && isMessageField(name))
      errors[name] ??= fieldMessages[name];
  }
  return { kind: 'incomplete', errors };
}

type MessageIdle = Idle & { readonly values: MessageValues };
type MessageRefused = Refused & { readonly values: MessageValues };
/** Some fields need fixing; the typed values come back with a message each. */
export type MessageIncomplete = {
  readonly kind: 'incomplete';
  readonly values: MessageValues;
  readonly errors: FieldErrors;
};
/** The message was received; the form gives way to the confirmation. */
export type MessageReceived = { readonly kind: 'received' };
type MessageUnacknowledged = Unacknowledged & {
  readonly values: MessageValues;
};

/** What the support form's action answers. */
export type MessageFormState =
  | MessageIdle
  | MessageIncomplete
  | MessageRefused
  | MessageUnacknowledged
  | MessageReceived;

/** The form as first shown, under a message id chosen for it. */
export const initialMessageForm = (
  messageId: string,
  replyEmail: string,
): MessageFormState => idle(blankMessage(messageId, replyEmail));

export const messageIncomplete = (
  values: MessageValues,
  errors: FieldErrors,
): MessageIncomplete => ({ kind: 'incomplete', values, errors });

/** A new object each time: the form tells a new answer from the last by identity. */
export const messageReceived = (): MessageReceived => ({ kind: 'received' });

/** Too many messages from this network: the typed values stay for later. */
export const messageRateLimited = (values: MessageValues): MessageRefused =>
  refusedWith(values, 'Too many messages right now. Try again later.');

/** The server could not take the message; it was not received. */
export const messageUnavailable = (values: MessageValues): MessageRefused =>
  refusedWith(values, 'We could not send your message. Try again.');

/** The answer was lost: the message may have arrived. */
export const messageUnacknowledged = (
  values: MessageValues,
): MessageUnacknowledged => ({ kind: 'unacknowledged', values });

/** What the form renders from each answer: the fields, their messages and the notice. */
export type MessageFields = {
  readonly values: MessageValues;
  readonly errors: FieldErrors;
  readonly notice: string | undefined;
};

const noErrors: FieldErrors = {};

export function messageFields(
  answer: Exclude<MessageFormState, MessageReceived>,
): MessageFields {
  switch (answer.kind) {
    case 'idle':
      return { values: answer.values, errors: noErrors, notice: undefined };
    case 'incomplete':
      return {
        values: answer.values,
        errors: answer.errors,
        notice: undefined,
      };
    case 'refused':
      return { values: answer.values, errors: noErrors, notice: answer.error };
    case 'unacknowledged':
      return {
        values: answer.values,
        errors: noErrors,
        notice:
          'We may not have received your message. Send it again; it will only arrive once.',
      };
  }
}

/** The answer when the call itself failed: the typed values kept, the post maybe received. */
export const messageLost = (form: FormData): MessageFormState =>
  messageUnacknowledged(messageValuesOf(formValues(form)));
