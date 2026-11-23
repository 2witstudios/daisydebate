'use client';
import { useState, type ReactNode } from 'react';
import {
  supportMessageLimits,
  supportTopics,
  type SupportTopic,
} from '@daisy/protocol/support-message';
import { Announcement } from '../components/announcement/announcement';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../form-action/form-action';
import { buttonClass } from '../components/button/button-class';
import { Button } from '../components/button/button';
import { controlClass } from '../components/form-field/form-field-class';
import { supportTopicLabels } from '../../features/support/labels';
import {
  honeypotField,
  initialMessageForm,
  messageFieldNames,
  messageFields,
  messageLost,
  type MessageField,
  type MessageFields,
  type MessageFormState,
} from '../../features/support/message-form';
import { SupportTopicNoteText } from './support-topic-note';

const CONFIRMATION_HEADING_ID = 'support-sent';
const NOTICE_ID = 'support-notice';
const fieldId = (name: MessageField) => `support-${name}`;
const errorId = (name: MessageField) => `support-${name}-error`;

/** Where focus goes once an answer settles: the confirmation, the first field to fix, or the notice. */
const focusTarget = (answer: MessageFormState): string | undefined => {
  if (answer.kind === 'received') return CONFIRMATION_HEADING_ID;
  if (answer.kind === 'idle') return undefined;
  const fields = messageFields(answer);
  const first = messageFieldNames.find(
    (name) => name !== 'messageId' && fields.errors[name] !== undefined,
  );
  return first ? fieldId(first) : NOTICE_ID;
};

const invalid = 'aria-invalid:border-live disabled:opacity-60';
const inputClass = `${controlClass} ${invalid}`;
const textareaClass = `min-h-support-message w-full min-w-0 resize-y rounded-md border border-border bg-surface-raised p-3 text-base text-ink ${invalid}`;

const isSupportTopic = (value: string): value is SupportTopic =>
  (supportTopics as readonly string[]).includes(value);

function Field({
  name,
  label,
  fields,
  children,
}: {
  readonly name: MessageField;
  readonly label: string;
  readonly fields: MessageFields;
  readonly children: ReactNode;
}) {
  const error = fields.errors[name];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={fieldId(name)} className="font-strong text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId(name)} className="text-sm text-live">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** What every control of one field shares: its name, id, value and error wiring. */
const controlProps = (
  name: MessageField,
  fields: MessageFields,
  pending: boolean,
) => ({
  id: fieldId(name),
  name,
  defaultValue: fields.values[name],
  disabled: pending,
  'aria-invalid': fields.errors[name] ? true : undefined,
  'aria-describedby': fields.errors[name] ? errorId(name) : undefined,
});

/**
 * The topic choice and the note it brings: a safety concern points to
 * Report, account or privacy to Settings. Mounted once per answer, so a
 * returned value is the one it starts from.
 */
function TopicField({
  fields,
  pending,
}: {
  readonly fields: MessageFields;
  readonly pending: boolean;
}) {
  const [topic, setTopic] = useState<SupportTopic>(
    isSupportTopic(fields.values.topic) ? fields.values.topic : 'problem',
  );
  return (
    <Field name="topic" label="What is this about" fields={fields}>
      <select
        {...controlProps('topic', fields, pending)}
        onChange={(event) => {
          if (isSupportTopic(event.target.value)) setTopic(event.target.value);
        }}
        className={inputClass}
      >
        {supportTopics.map((value) => (
          <option key={value} value={value}>
            {supportTopicLabels[value]}
          </option>
        ))}
      </select>
      <Announcement as="div" kind="progress" className="text-sm text-ink-muted">
        <SupportTopicNoteText topic={topic} />
      </Announcement>
    </Field>
  );
}

/**
 * The /support form (SUPP-1). A sent message gives way to the confirmation;
 * anything to fix comes back beside its field with the typed values kept.
 */
export function SupportForm({
  messageId,
  replyEmail,
  action,
}: {
  readonly messageId: string;
  readonly replyEmail: string;
  readonly action: FormAction<MessageFormState>;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialMessageForm(messageId, replyEmail),
    messageLost,
  );
  useFocusAfterAnswer(answer, focusTarget(answer), !pending);
  if (answer.kind === 'received')
    return (
      <section
        aria-labelledby={CONFIRMATION_HEADING_ID}
        className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
      >
        <h2
          id={CONFIRMATION_HEADING_ID}
          tabIndex={-1}
          className="font-display text-lg font-bold"
        >
          Thanks. Your message was sent.
        </h2>
        <p className="text-ink-muted">
          We&rsquo;ll reply to the email you gave us.
        </p>
        <a href="/help" className={`${buttonClass('secondary')} self-start`}>
          Back to Help
        </a>
      </section>
    );
  const fields = messageFields(answer);
  const props = (name: MessageField) => controlProps(name, fields, pending);
  return (
    <form
      action={post}
      noValidate
      aria-label="Contact support"
      className="flex min-w-0 flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
    >
      <input type="hidden" name="messageId" value={fields.values.messageId} />
      {/* The spam trap: hidden from people and assistive technology alike. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="support-website">Website</label>
        <input
          id="support-website"
          type="text"
          name={honeypotField}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>
      {/* Remount on the answer's topic: React resets a mounted select to its first default. */}
      <TopicField key={fields.values.topic} fields={fields} pending={pending} />
      <Field name="message" label="Message" fields={fields}>
        <textarea
          {...props('message')}
          maxLength={supportMessageLimits.message}
          className={textareaClass}
        />
      </Field>
      <Field
        name="about"
        label="What page or round is this about? (optional)"
        fields={fields}
      >
        <input
          {...props('about')}
          type="text"
          maxLength={supportMessageLimits.about}
          className={inputClass}
        />
      </Field>
      <Field name="replyEmail" label="Email for our reply" fields={fields}>
        <input
          {...props('replyEmail')}
          type="email"
          autoComplete="email"
          maxLength={supportMessageLimits.replyEmail}
          className={inputClass}
        />
      </Field>
      {(fields.notice ?? fields.errors.messageId) ? (
        <Announcement
          as="p"
          id={NOTICE_ID}
          kind="problem"
          tabIndex={-1}
          className="text-sm text-live"
        >
          {fields.notice ?? fields.errors.messageId}
        </Announcement>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          Send message
        </Button>
      </div>
    </form>
  );
}
