import Link from 'next/link';
import type { ReviewView } from '../../../features/prep/brief-review';
import { inertActions } from '../../../features/prep/actions';
import { permissionLabel, permissions } from '../../../features/prep/sharing';
import { Avatar } from '../../components/avatar/avatar';
import { buttonClass } from '../../components/button/button-class';
import { controlClass } from '../form-controls/form-class';
import { IconButtonInert } from '../inert-action/icon-button-inert';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import { StateAlert } from '../state-alert/state-alert';

type Share = NonNullable<ReviewView['share']>;

function GrantRow({ grant }: { readonly grant: Share['grants'][number] }) {
  const selectId = `perm-${grant.id}`;
  return (
    <li className="flex min-h-16 items-center gap-3">
      <span className="inline-flex -space-x-2">
        {grant.initials.map((initial) => (
          <Avatar key={initial} name={initial} size="sm" nameVisible />
        ))}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-strong">{grant.name}</span>
        <span className="text-sm text-ink-muted">{grant.detail}</span>
      </span>
      <label
        htmlFor={selectId}
        className="sr-only"
      >{`Permission for ${grant.name}`}</label>
      <select
        id={selectId}
        disabled
        defaultValue={grant.permission}
        className={controlClass}
      >
        {permissions.map((permission) => (
          <option key={permission} value={permission}>
            {permissionLabel[permission]}
          </option>
        ))}
      </select>
      <IconButtonInert label={`Remove ${grant.name}`} symbol="x" />
    </li>
  );
}

/**
 * The share dialog. Open and close are links (the state is in the URL); the
 * add row is a GET form that checks the target; changing a grant needs the
 * service, so the permission selects are shown but disabled.
 */
export function ShareDialog({ share }: { readonly share: Share }) {
  const { target } = share;
  return (
    <div className="fixed inset-0 z-10 flex items-start justify-end bg-scrim p-4 max-compact:items-end max-compact:p-0">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Share this brief"
        className="flex max-h-full w-full max-w-search flex-col gap-4 overflow-y-auto rounded-xl border border-border-strong bg-surface-raised p-5 shadow-3 max-compact:max-w-none max-compact:rounded-b-none"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Share this brief</h2>
          <Link
            href={share.closeHref}
            aria-label="Close"
            className="inline-flex size-12 items-center justify-center text-ink-muted"
          >
            <PrepIcon name="x" size={18} />
          </Link>
        </header>
        <p className="flex items-center gap-2 rounded-md bg-accent-soft p-3 text-sm">
          <PrepIcon name="lock" size={16} className="text-accent" />
          Private to you until you add someone
        </p>
        <h3 className="text-sm font-bold text-ink-muted">People with access</h3>
        {share.grants.length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody yet.</p>
        ) : (
          <ul>
            {share.grants.map((grant) => (
              <GrantRow key={grant.id} grant={grant} />
            ))}
          </ul>
        )}
        <form
          action={share.closeHref}
          method="get"
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="share" value="open" />
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-strong text-ink-muted">
            Add a team or @handle
            <input
              type="search"
              name="add"
              defaultValue={share.addName}
              placeholder="Add a team or @handle"
              className={controlClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-strong text-ink-muted">
            Permission for new person
            <select
              name="perm"
              defaultValue={share.addPermission}
              className={controlClass}
            >
              {permissions.map((permission) => (
                <option key={permission} value={permission}>
                  {permissionLabel[permission]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass('secondary')}>
            Check
          </button>
        </form>
        {share.notice === null ? null : <StateAlert notice={share.notice} />}
        {target.kind === 'ready' ? (
          <p role="status" className="text-sm text-ink-muted">
            {`${target.name} can be given “${permissionLabel[target.permission]}”. `}
            <InertActionButton action={inertActions.addGrant} variant="ghost" />
          </p>
        ) : null}
        {target.kind === 'unknown' ? (
          <p role="alert" className="text-sm text-live">
            No one with that handle.
          </p>
        ) : null}
        {target.kind === 'invalid' ? (
          <p role="alert" className="text-sm text-live">
            Enter a team you belong to or a person as @handle.
          </p>
        ) : null}
        <label className="flex items-start gap-3 text-base">
          <input
            type="checkbox"
            disabled
            defaultChecked={share.includeCards}
            className="mt-1 size-5 accent-accent"
          />
          <span>{`Include the ${share.cardCount} attached cards (view only)`}</span>
        </label>
        <footer className="flex items-center justify-between gap-3">
          <InertActionButton
            action={inertActions.stopSharing}
            variant="ghost"
          />
          <Link
            href={share.closeHref}
            className={`${buttonClass('primary')} no-underline hover:no-underline`}
          >
            Done
          </Link>
        </footer>
      </section>
    </div>
  );
}
