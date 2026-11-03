import type { SpectatorChatMessage } from '@daisy/protocol';
import { ReportForm } from '../content-moderation/report-form';

/** The audience's messages, oldest first. A removed one keeps its place. */
export function SpectatorChatList({
  messages,
  reportAction,
}: {
  readonly messages: readonly SpectatorChatMessage[];
  /** Absent for a reader with no account, who cannot report. */
  readonly reportAction?: (form: FormData) => void | Promise<void>;
}) {
  if (messages.length === 0)
    return <p className="text-sm text-ink-muted">No messages yet.</p>;
  return (
    <ul aria-label="Chat messages" className="flex flex-col gap-3">
      {messages.map((message) => (
        <li key={message.id} className="flex flex-col gap-1 text-sm">
          {message.text === null ? (
            <span className="text-ink-faint italic">
              This message was removed.
            </span>
          ) : (
            <>
              <span className="font-strong text-ink">
                {message.author ? `@${message.author}` : 'A closed account'}
              </span>
              <span className="text-ink-muted">{message.text}</span>
              {reportAction ? (
                <ReportForm
                  targetKind="chat_message"
                  targetId={message.id}
                  label="Report"
                  action={reportAction}
                />
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
