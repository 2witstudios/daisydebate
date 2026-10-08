import Link from 'next/link';
import { inertActions } from '../../../features/prep/actions';
import { permissionLabel, permissions } from '../../../features/prep/sharing';
import type { TeamView } from '../../../features/prep/teams/team-view';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { controlClass } from '../form-controls/form-class';
import { InertActionButton } from '../inert-action/inert-action';
import { ItemTile } from '../item-tile/item-tile';
import { PrepIcon } from '../prep-icon/prep-icon';
import { PrepTabs } from '../prep-tabs/prep-tabs';

const listBox =
  'overflow-hidden rounded-lg border border-border bg-surface-raised';
const row =
  'flex min-h-16 items-center gap-3 border-t border-border px-4 py-2 first:border-t-0';

function SharedItems({ view }: { readonly view: TeamView }) {
  return (
    <ul aria-label="Shared items" className={listBox}>
      {view.items.map((item) => (
        <li key={item.id} className={row}>
          <ItemTile kind={item.kind} />
          <span className="flex min-w-0 flex-1 flex-col">
            <Link
              href={item.href}
              className="text-base font-strong text-ink no-underline hover:no-underline"
            >
              {item.title}
            </Link>
            <span className="text-sm text-ink-muted">{item.subtitle}</span>
          </span>
          <label
            htmlFor={item.id}
            className="sr-only"
          >{`Permission for ${item.title}`}</label>
          <select
            id={item.id}
            defaultValue={item.permission}
            className={controlClass}
          >
            {permissions.map((permission) => (
              <option key={permission} value={permission}>
                {permissionLabel[permission]}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}

function Members({ view }: { readonly view: TeamView }) {
  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Members" className={listBox}>
        {view.members.map((member) => (
          <li key={member.handle} className={row}>
            <Avatar name={member.handle} size="md" nameVisible />
            <span className="flex-1 text-base font-strong">{member.label}</span>
            <span className="text-sm text-ink-muted">{member.role}</span>
            {member.isViewer || !view.isAdmin ? null : (
              <InertActionButton
                action={inertActions.manageMember}
                variant="ghost"
              />
            )}
          </li>
        ))}
      </ul>
      {view.isAdmin ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex max-w-search min-w-0 flex-1 flex-col gap-1 text-xs font-strong text-ink-muted">
            Invite by @handle
            <input
              type="search"
              name="invite"
              placeholder="Invite by @handle"
              className={controlClass}
            />
          </label>
          <InertActionButton action={inertActions.sendInvite} />
        </div>
      ) : null}
      <p className="text-sm text-ink-faint">{view.pendingLine}</p>
    </div>
  );
}

function Activity({ view }: { readonly view: TeamView }) {
  return (
    <ul aria-label="Activity" className={listBox}>
      {view.activity.map((entry) => (
        <li key={entry.text} className={row}>
          <PrepIcon name={entry.symbol} size={16} className="text-ink-faint" />
          <span className="flex-1 text-base">{entry.text}</span>
          <span className="text-sm text-ink-faint">{entry.when}</span>
        </li>
      ))}
    </ul>
  );
}

/** A team in Prep: what it shares, who is in it, what happened. */
export function TeamPage({ view }: { readonly view: TeamView }) {
  const { team } = view;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:px-4">
      <Breadcrumb
        crumbs={[
          { label: 'Prep', href: '/prep' },
          { label: 'Teams' },
          { label: team.name },
        ]}
      />
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="min-w-0 flex-1 font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          {team.name}
        </h1>
        <span className="inline-flex -space-x-2">
          {team.members.map((member) => (
            <Avatar
              key={member.handle}
              name={member.handle}
              size="md"
              nameVisible
            />
          ))}
        </span>
        {view.isAdmin ? (
          <InertActionButton
            action={inertActions.invite}
            variant="primary"
            symbol="plus"
          />
        ) : null}
      </header>
      <div className="flex gap-6 max-rail:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PrepTabs
            label="View"
            current={view.tab}
            tabs={view.tabs.map((t) => ({
              id: t.id,
              label: t.label,
              href: t.href,
              ...(t.count === undefined ? {} : { count: t.count }),
            }))}
          />
          {view.tab === 'items' ? <SharedItems view={view} /> : null}
          {view.tab === 'members' ? <Members view={view} /> : null}
          {view.tab === 'activity' ? <Activity view={view} /> : null}
        </div>
        <aside
          aria-label="Team privacy"
          className="flex w-rail shrink-0 flex-col gap-4 max-rail:w-full"
        >
          <section className="flex flex-col items-start gap-3 rounded-lg bg-surface p-5 shadow-1">
            <h2 className="text-base font-bold">Leave this team</h2>
            <p className="text-sm text-ink-muted">
              Items you shared stay yours.
            </p>
            <InertActionButton action={inertActions.leaveTeam} />
          </section>
          <Badge tone="neutral">Nothing is public</Badge>
        </aside>
      </div>
    </div>
  );
}
