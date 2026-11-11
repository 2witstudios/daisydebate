'use client';
import { useEffect, useRef, useState } from 'react';
import { systemId } from '@daisy/clock';
import { floorFormUnavailable } from '../../features/messaging/round-floor/form';
import {
  floorAcceptedMessage,
  floorFields,
  floorIdle,
  type FloorFormState,
} from '../../features/messaging/round-floor/form-state';
import {
  useFormAction,
  useFocusAfterAnswer,
  type FormAction,
} from '../form-action/form-action';
import { CountedTextarea } from '../messaging/counted-textarea';
import { floorEditSeed, type FloorEditDraft } from './edit-draft';

const reasons = {
  harassment: 'Harassment',
  hate: 'Hate',
  sexual_content: 'Sexual content',
  violence: 'Violence',
  self_harm: 'Self harm',
  impersonation: 'Impersonation',
  spam: 'Spam',
  other: 'Other',
};
export function FloorMessageControls({
  messageId,
  text,
  own,
  locked,
  editingLocked = false,
  changeVersion,
  maxUnits,
  mutateAction,
  reportAction,
  onSent,
  returnFocusId,
  keepDraft,
  releaseDraft,
}: {
  readonly returnFocusId: string;
  readonly keepDraft?: () => void;
  readonly releaseDraft?: () => void;
  readonly messageId: string;
  readonly text: string;
  readonly own: boolean;
  readonly locked: boolean;
  readonly editingLocked?: boolean;
  readonly changeVersion: number;
  readonly maxUnits: number;
  readonly mutateAction: FormAction<FloorFormState>;
  readonly reportAction: FormAction<FloorFormState>;
  readonly onSent: (id: string) => void;
}) {
  const [kind, setKind] = useState<'edit' | 'remove' | 'report'>(
    own ? 'edit' : 'report',
  );
  const [reason, setReason] = useState('harassment');
  const [dirty, setDirty] = useState<FloorEditDraft | null>(null);
  const [initial] = useState<FloorFormState>(() =>
    floorIdle(systemId.next(), text),
  );
  const [answer, post, pending] = useFormAction<FloorFormState>(
    kind === 'report' ? reportAction : mutateAction,
    initial,
    floorFormUnavailable,
  );
  const seen = useRef(answer);
  useEffect(() => {
    const accepted = floorAcceptedMessage(answer);
    if (accepted !== undefined && answer !== seen.current) {
      seen.current = answer;
      if (kind === 'remove') releaseDraft?.();
      onSent(accepted);
    }
  }, [answer, onSent, kind, releaseDraft]);
  const fields = floorFields(answer);
  const removing = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const ownedFocus = useRef(false);
  useEffect(() => {
    if (!locked || !ownedFocus.current) return;
    if (
      document.activeElement === document.body ||
      form.current?.contains(document.activeElement)
    )
      document.getElementById(returnFocusId)?.focus();
    ownedFocus.current = false;
  }, [locked, returnFocusId]);

  useEffect(
    () => () => {
      if (removing.current && document.activeElement === document.body)
        document.getElementById(returnFocusId)?.focus();
    },
    [returnFocusId],
  );
  const noticeId = `floor-notice-${messageId}`;
  const fieldId = `floor-edit-${messageId}`;
  const submitId = `floor-action-${messageId}`;
  const notice =
    fields.notice ??
    (kind === 'report' && floorAcceptedMessage(answer) !== undefined
      ? 'Report received.'
      : null);
  useFocusAfterAnswer(
    answer,
    locked
      ? returnFocusId
      : notice
        ? noticeId
        : kind === 'remove'
          ? returnFocusId
          : kind === 'edit'
            ? fieldId
            : submitId,
    !pending,
  );
  const seed = floorEditSeed(answer, { text, changeVersion }, dirty);
  return (
    <details
      className="text-sm"
      onToggle={(event) => {
        const hasDraft =
          dirty?.requestId === fields.requestId ||
          pending ||
          fields.retrying ||
          fields.notice;
        if (own && !event.currentTarget.open && !hasDraft) releaseDraft?.();
      }}
    >
      <summary
        className="cursor-pointer"
        onClick={() => {
          if (own) keepDraft?.();
        }}
      >
        {own ? 'Message options' : 'Report message'}
      </summary>
      <form
        ref={form}
        onFocusCapture={() => {
          ownedFocus.current = true;
        }}
        onBlurCapture={(event) => {
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget as Node)
          )
            ownedFocus.current = false;
        }}
        action={post}
        onSubmit={() => {
          removing.current = kind === 'remove';
        }}
        className="flex flex-col gap-2 py-2"
      >
        <input type="hidden" name="messageId" value={messageId} />
        <input type="hidden" name="requestId" value={fields.requestId} />
        {own ? (
          <select
            aria-label="Message action"
            name="kind"
            value={kind}
            disabled={pending || fields.retrying || locked}
            onChange={(event) =>
              setKind(event.target.value === 'remove' ? 'remove' : 'edit')
            }
          >
            <option value="edit" disabled={editingLocked}>
              Edit
            </option>
            <option value="remove">Remove</option>
          </select>
        ) : null}
        {own && (pending || fields.retrying || locked) ? (
          <input type="hidden" name="kind" value={kind} />
        ) : null}
        {kind === 'edit' ? (
          <CountedTextarea
            key={seed.key}
            id={fieldId}
            name="text"
            aria-label="Edit message"
            defaultValue={seed.text}
            maxUnits={maxUnits}
            required
            onInput={() =>
              setDirty((current) =>
                current?.requestId === fields.requestId
                  ? current
                  : { requestId: fields.requestId, baseline: seed.baseline },
              )
            }
            readOnly={locked || editingLocked || fields.retrying}
            disabled={pending}
            className="rounded-sm border border-border bg-background p-2"
          />
        ) : null}
        {kind === 'report' ? (
          <select
            name="reason"
            aria-label="Report reason"
            disabled={pending || fields.retrying || locked}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {Object.entries(reasons).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : null}
        {kind === 'report' && (pending || fields.retrying || locked) ? (
          <input type="hidden" name="reason" value={reason} />
        ) : null}
        {notice ? (
          <p id={noticeId} role="status" tabIndex={-1}>
            {notice}
          </p>
        ) : null}
        <button
          id={submitId}
          type="submit"
          disabled={pending || locked || (kind === 'edit' && editingLocked)}
          className="min-h-room-target cursor-pointer self-start font-strong"
        >
          {pending
            ? 'Submitting…'
            : fields.retrying
              ? 'Retry'
              : kind === 'edit'
                ? 'Save edit'
                : kind === 'remove'
                  ? 'Remove message'
                  : 'Submit report'}
        </button>
      </form>
    </details>
  );
}
