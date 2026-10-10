import type { MessagingFileFormState } from '../../features/messaging/forms/file-form';
/** A real multipart POST works before hydration and never serializes file bytes into state. */
export function AttachmentForm({
  channelId,
  messageId,
  state,
}: {
  readonly channelId: string;
  readonly messageId: string;
  readonly state: MessagingFileFormState;
}) {
  return (
    <form
      action={`/api/messaging/channels/${channelId}/messages/${messageId}/attachments`}
      method="post"
      encType="multipart/form-data"
      className="flex flex-col gap-4 rounded-lg border border-border p-5"
    >
      <input type="hidden" name="requestId" value={state.requestId} />
      {state.notice ? <p role="status">{state.notice}</p> : null}
      {state.filename ? <p>Selected file: {state.filename}</p> : null}
      <label>
        Image or PDF{' '}
        <input
          name="file"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          required
        />
      </label>
      <button type="submit">Attach file</button>
    </form>
  );
}
