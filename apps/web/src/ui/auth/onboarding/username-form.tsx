import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import { AuthFrame, AuthHeading, taglinePanel } from '../auth-frame/auth-frame';
import { CopyNotice } from '../notice/notice';
import { usernameNotices } from './username-notices';
import type { UsernameNotice } from './username-state';

export type UsernameFormProps = {
  readonly username: string;
  readonly pending: boolean;
  readonly notice?: UsernameNotice | undefined;
  readonly typeUsername: (username: string) => void;
  readonly submit: () => void;
};

const NOTICE_ID = 'username-notice';
const HINT_ID = 'username-hint';

/**
 * Choosing the public name. It is the identity opponents and spectators see,
 * so the form says so, states the rule up front, and keeps what was typed
 * through every recoverable error.
 */
export function UsernameForm({
  username,
  pending,
  notice,
  typeUsername,
  submit,
}: UsernameFormProps) {
  const copy = notice === undefined ? undefined : usernameNotices[notice];
  const refusesName = notice === 'invalid' || notice === 'taken';
  return (
    <AuthFrame panel={taglinePanel}>
      <AuthHeading eyebrow="One last step" title="Choose your username.">
        This is the name opponents and spectators see. You can play once you
        have one.
      </AuthHeading>
      <form
        className="flex flex-col gap-3"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="username" className="text-sm font-semibold">
            Username
          </label>
          <div className="flex gap-3 max-narrow:flex-col">
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => typeUsername(event.currentTarget.value)}
              disabled={pending}
              aria-invalid={refusesName ? true : undefined}
              aria-describedby={
                refusesName ? `${HINT_ID} ${NOTICE_ID}` : HINT_ID
              }
              className="h-auth-control min-w-0 grow rounded-md border border-border-strong bg-surface-raised px-4 text-md text-ink placeholder:text-ink-faint disabled:opacity-60 aria-invalid:border-live"
            />
            <Button type="submit" disabled={pending} className="h-auth-control">
              {pending ? 'Saving…' : 'Continue'}
              <Icon name="arrowRight" size={18} />
            </Button>
          </div>
          <p id={HINT_ID} className="text-sm text-ink-muted">
            3 to 32 letters, numbers, underscores or hyphens.
          </p>
        </div>
        <CopyNotice id={NOTICE_ID} copy={copy} />
      </form>
      <p role="status" className="sr-only">
        {pending ? 'Saving your username…' : ''}
      </p>
    </AuthFrame>
  );
}
