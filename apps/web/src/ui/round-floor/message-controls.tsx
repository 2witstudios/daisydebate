'use client';
import { useEffect, useRef, useState } from 'react';
import { systemId } from '@daisy/clock';
import {
  floorFormUnavailable,
  type FloorFormState,
} from '../../features/messaging/round-floor/form';
import { useFormAction, type FormAction } from '../form-action/form-action';
import { CountedTextarea } from '../messaging/counted-textarea';

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
  maxUnits,
  mutateAction,
  reportAction,
  onSent,
}: {
  readonly messageId: string;
  readonly text: string;
  readonly own: boolean;
  readonly locked: boolean;
  readonly editingLocked?: boolean;
  readonly maxUnits: number;
  readonly mutateAction: FormAction<FloorFormState>;
  readonly reportAction: FormAction<FloorFormState>;
  readonly onSent: (id: string) => void;
}) {
  const [kind, setKind] = useState<'edit' | 'remove' | 'report'>(
    own ? 'edit' : 'report',
  );
  const [reason, setReason] = useState('harassment');
  const [initial] = useState<FloorFormState>(() => ({
    text,
    requestId: systemId.next(),
  }));
  const [answer, post, pending] = useFormAction<FloorFormState>(
    kind === 'report' ? reportAction : mutateAction,
    initial,
    floorFormUnavailable,
  );
  const seen = useRef(answer);
  useEffect(() => {
    if (answer.sent && answer !== seen.current) {
      seen.current = answer;
      onSent(answer.sent);
    }
  }, [answer, onSent]);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">
        {own ? 'Message options' : 'Report message'}
      </summary>
      <form action={post} className="flex flex-col gap-2 py-2">
        <input type="hidden" name="messageId" value={messageId} />
        <input type="hidden" name="requestId" value={answer.requestId} />
        {own ? (
          <select
            aria-label="Message action"
            name="kind"
            value={kind}
            disabled={pending || answer.uncertain === true || locked}
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
        {own && (pending || answer.uncertain || locked) ? (
          <input type="hidden" name="kind" value={kind} />
        ) : null}
        {kind === 'edit' ? (
          <CountedTextarea
            key={answer.text}
            id={`floor-edit-${messageId}`}
            name="text"
            aria-label="Edit message"
            defaultValue={answer.text}
            maxUnits={maxUnits}
            required
            readOnly={locked || editingLocked || answer.uncertain === true}
            disabled={pending}
            className="rounded-sm border border-border bg-background p-2"
          />
        ) : null}
        {kind === 'report' ? (
          <select
            name="reason"
            aria-label="Report reason"
            disabled={pending || answer.uncertain === true || locked}
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
        {kind === 'report' && (pending || answer.uncertain || locked) ? (
          <input type="hidden" name="reason" value={reason} />
        ) : null}
        {answer.notice ? <p role="status">{answer.notice}</p> : null}
        <button
          type="submit"
          disabled={pending || locked || (kind === 'edit' && editingLocked)}
          className="min-h-room-target cursor-pointer self-start font-strong"
        >
          {pending
            ? 'Submitting…'
            : answer.uncertain
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
