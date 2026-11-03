'use client';
import {
  audienceReactionKinds,
  SPECTATOR_CHAT_UNITS,
  type AudienceSnapshot,
} from '@daisy/protocol';
import Link from 'next/link';
import type { FormStateAction } from '../form-action/action-form';
import { ActionForm } from '../form-action/action-form';
import { Button } from '../components/button/button';
import { reactionLabels, viewerCountText } from './audience-copy';
import { SpectatorChatList } from './spectator-chat-list';
import { useAudienceSnapshot } from './use-audience-snapshot';

/** Who is reading, which decides what they can do. */
export type AudienceViewer =
  | { readonly kind: 'visitor'; readonly signInHref: string }
  | { readonly kind: 'needs-username' }
  | {
      readonly kind: 'account';
      readonly requestId: string;
      readonly postChat: FormStateAction;
      readonly react: FormStateAction;
      readonly reportMessage: (form: FormData) => void | Promise<void>;
    };

export type AudiencePanelProps = {
  readonly initial: AudienceSnapshot;
  readonly viewer: AudienceViewer;
  /** Off for a seat during the Round, which reads only what it may. */
  readonly shown: {
    readonly chat: boolean;
    readonly reactions: boolean;
    readonly viewers: boolean;
  };
};

function ChatComposer({
  viewer,
}: {
  readonly viewer: Extract<AudienceViewer, { kind: 'account' }>;
}) {
  return (
    <ActionForm
      action={viewer.postChat}
      label="Post to spectator chat"
      className="flex flex-col gap-2"
      focusOnRefusal="spectator-chat-text"
    >
      {({ values, error, pending }) => (
        <>
          <input type="hidden" name="requestId" value={viewer.requestId} />
          <label className="flex flex-col gap-1 text-sm text-ink">
            Your message
            <textarea
              id="spectator-chat-text"
              name="text"
              required
              rows={2}
              maxLength={SPECTATOR_CHAT_UNITS}
              defaultValue={values['text'] ?? ''}
            />
          </label>
          <p className="text-xs text-ink-muted">
            Messages appear when the broadcast reaches them.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-live">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="secondary" disabled={pending}>
            Post
          </Button>
        </>
      )}
    </ActionForm>
  );
}

function ReactionBar({
  snapshot,
  viewer,
}: {
  readonly snapshot: AudienceSnapshot;
  readonly viewer: AudienceViewer;
}) {
  const count = (kind: (typeof audienceReactionKinds)[number]) =>
    snapshot.reactions.find((row) => row.kind === kind)?.count ?? 0;
  if (viewer.kind === 'account' && snapshot.interaction === 'open')
    return (
      <ActionForm
        action={viewer.react}
        label="React to this Round"
        className="flex flex-wrap items-center gap-2"
      >
        {({ error, pending }) => (
          <>
            {audienceReactionKinds.map((kind) => (
              <Button
                key={kind}
                type="submit"
                variant="secondary"
                name="kind"
                value={kind}
                disabled={pending}
              >
                {`${reactionLabels[kind]} ${count(kind)}`}
              </Button>
            ))}
            {error ? (
              <p role="alert" className="text-sm text-live">
                {error}
              </p>
            ) : null}
          </>
        )}
      </ActionForm>
    );
  return (
    <ul className="flex flex-wrap gap-2 text-sm text-ink-muted">
      {audienceReactionKinds.map((kind) => (
        <li key={kind}>{`${reactionLabels[kind]} ${count(kind)}`}</li>
      ))}
    </ul>
  );
}

/**
 * The audience's own activity on a Round: chat, reactions and the count, all on
 * the spectator timeline. Anyone reads; an account takes part. Every form is a
 * native post, and with script the view refreshes itself.
 */
export function AudiencePanel({ initial, viewer, shown }: AudiencePanelProps) {
  const polling = shown.chat || shown.reactions || shown.viewers;
  const snapshot = useAudienceSnapshot(initial, polling);
  const count = shown.viewers ? viewerCountText(snapshot.viewers) : null;
  return (
    <section aria-label="Audience" className="flex flex-col gap-4">
      {count ? <p className="text-sm text-ink-muted">{count}</p> : null}
      {shown.reactions ? (
        <ReactionBar snapshot={snapshot} viewer={viewer} />
      ) : null}
      {shown.chat ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold text-ink">Chat</h2>
          <SpectatorChatList
            messages={snapshot.messages}
            {...(viewer.kind === 'account'
              ? { reportAction: viewer.reportMessage }
              : {})}
          />
          {snapshot.interaction !== 'open' ? (
            <p className="text-sm text-ink-muted">Chat is closed.</p>
          ) : viewer.kind === 'account' ? (
            <ChatComposer viewer={viewer} />
          ) : viewer.kind === 'visitor' ? (
            <p className="text-sm text-ink-muted">
              <Link href={viewer.signInHref}>Sign in</Link> to chat and react.
              Watching needs no account.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              <Link href="/onboarding/username">Choose a username</Link> to
              chat.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Spectator chat is hidden from you during this Round.
        </p>
      )}
    </section>
  );
}
