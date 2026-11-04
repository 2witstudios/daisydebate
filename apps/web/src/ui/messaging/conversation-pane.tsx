import type { ReactNode } from 'react';
import { Icon } from '../components/icon/icon';
import { cn } from '../cn';
import { ConversationLink } from './conversation-navigation';

const backClass =
  'hidden size-nav-target shrink-0 items-center justify-center rounded-sm text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline max-compact:flex';

/**
 * What a Messages route shows beside the list: a header strip and a body that
 * scrolls on its own. Marking the pane open is what puts it in front below
 * compact, and the back link is what returns to the list there.
 */
export function ConversationPane({
  title,
  lede,
  leading,
  actions,
  bare = false,
  children,
}: {
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  /** Beside the title: the conversation's avatar. */
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
  /** The body lays itself out: a conversation's history and composer. */
  readonly bare?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div data-open-pane className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex h-pane-header shrink-0 items-center gap-3 border-b border-border px-6 max-compact:px-2">
        <ConversationLink
          href="/messages"
          aria-label="Back to messages"
          className={backClass}
        >
          <Icon name="chevronLeft" />
        </ConversationLink>
        {leading}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-base leading-tight font-strong">
            {title}
          </h1>
          {lede ? (
            <p className="truncate text-xs leading-tight text-ink-muted">
              {lede}
            </p>
          ) : null}
        </div>
        {actions}
      </header>
      <div
        className={cn(
          'min-h-0 flex-1',
          bare
            ? 'flex flex-col'
            : 'flex flex-col gap-6 overflow-y-auto p-6 max-narrow:p-4',
        )}
      >
        {children}
      </div>
    </div>
  );
}
