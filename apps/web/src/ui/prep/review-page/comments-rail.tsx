import type { ReviewView } from '../../../features/prep/brief-review';
import { inertActions } from '../../../features/prep/actions';
import { Avatar } from '../../components/avatar/avatar';
import {
  fieldClass,
  labelClass,
  textareaClass,
} from '../form-controls/form-class';
import { InertActionButton } from '../inert-action/inert-action';

/** Comments on a shared brief; they reach only the people it is shared with. */
export function CommentsRail({ view }: { readonly view: ReviewView }) {
  return (
    <aside
      aria-label="Comments"
      className="flex w-rail shrink-0 flex-col gap-4 max-rail:w-full"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          Comments
        </h2>
        <p className="text-sm text-ink-muted">{view.threadSummary}</p>
      </div>
      <p className="text-sm text-ink-muted">
        Comments reach only people this brief is shared with.
      </p>
      {view.threads.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-ink-muted">
          No comments yet. Share the brief and a teammate can start one.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {view.threads.map((thread) => (
            <li
              key={thread.id}
              className="flex flex-col gap-2 rounded-lg bg-surface p-4 shadow-1"
            >
              <div className="flex items-center gap-2">
                <Avatar
                  name={thread.author.replace('@', '')}
                  size="sm"
                  nameVisible
                />
                <span className="text-sm font-strong">{thread.author}</span>
                <span className="text-xs text-ink-faint">{thread.when}</span>
              </div>
              <p className="text-xs font-strong text-ink-muted">{`On: ${thread.anchor}`}</p>
              <p className="text-base">{thread.body}</p>
              {thread.replies.map((reply) => (
                <div
                  key={reply.when}
                  className="ml-6 flex flex-col gap-1 border-l border-border pl-3"
                >
                  <p className="text-sm">
                    <strong>{reply.author}</strong>
                    <span className="text-ink-faint">{` · ${reply.when}`}</span>
                  </p>
                  <p className="text-base">{reply.body}</p>
                </div>
              ))}
              {thread.resolved ? (
                <p className="text-xs font-strong text-online">Resolved</p>
              ) : (
                <div className="flex gap-2">
                  <InertActionButton
                    action={inertActions.reply}
                    variant="ghost"
                  />
                  <InertActionButton
                    action={inertActions.resolve}
                    variant="ghost"
                    symbol="check"
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className={fieldClass}>
        <label htmlFor="cmt" className={labelClass}>
          Comment as you
        </label>
        <textarea
          id="cmt"
          name="cmt"
          rows={3}
          placeholder="Reply or start a thread on the selected text"
          className={textareaClass}
        />
        <InertActionButton
          action={inertActions.comment}
          variant="primary"
          symbol="comment"
        />
      </div>
    </aside>
  );
}
