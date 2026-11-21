import type { ReactNode } from 'react';
import type { TabAction } from '../../../features/tab/action';
import Link from 'next/link';
import type { People as Read } from '../../../features/tab/people';
import type { TimelineRail } from '../../../features/tab/tournament';
import { cn } from '../../cn';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { PageHeader } from '../../components/page-header/page-header';
import { ActionButton } from '../action-control/action-control';
import { HostShell } from '../host-shell/host-shell';
import { eyebrowClass, ListCard, ListRow } from '../list-card/list-card';

/**
 * Members with the grants they hold, and Daisy's preset roles with what each
 * allows. A role is shown, never edited: making your own comes later.
 */
export function People<Command>({
  rail,
  people,
  renderCommand,
}: {
  readonly rail: TimelineRail;
  readonly people: Read<Command>;
  readonly renderCommand: (command: Command) => ReactNode;
}) {
  const renderAction = (action: TabAction<Command> | null, about?: string) =>
    action === null ? null : action.kind === 'command' ? (
      renderCommand(action.command)
    ) : (
      <ActionButton
        action={action}
        {...(about ? { about, size: 'small' as const } : {})}
      />
    );
  return (
    <HostShell
      rail={rail}
      current="people"
      asideLabel={`${people.role.name} role`}
      aside={
        <>
          <div className="flex flex-col">
            <span className={eyebrowClass}>Role</span>
            <strong className="font-display text-xl font-bold">
              {people.role.name}
            </strong>
          </div>
          <div className="flex flex-col gap-2">
            <h2 className={eyebrowClass}>Can</h2>
            <ul className="flex flex-col gap-2">
              {people.role.permissions.map((permission) => (
                <li
                  key={permission.label}
                  className={cn(
                    'flex items-start gap-2 text-sm',
                    !permission.allowed && 'text-ink-muted',
                  )}
                >
                  <Icon
                    name={permission.allowed ? 'check' : 'close'}
                    size={16}
                    className="mt-1 shrink-0"
                  />
                  <span>
                    <span className="sr-only">
                      {permission.allowed ? 'Can: ' : 'Cannot: '}
                    </span>
                    {permission.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-ink-muted">{people.role.conflictRule}</p>
          <p className="text-sm text-ink-muted">
            {people.role.preset ? 'A Daisy preset.' : 'An organization role.'}
          </p>
        </>
      }
    >
      <PageHeader
        title={
          <span id="tab-people-title" tabIndex={-1}>
            People
          </span>
        }
        actions={renderAction(people.give)}
      />
      <ListCard>
        <ul>
          {people.people.map((person) => (
            <ListRow
              key={person.id}
              title={person.name}
              detail={
                <>
                  {person.detail}
                  {person.conflict === null ? null : (
                    <strong className="block font-strong text-live">
                      {person.conflict}
                    </strong>
                  )}
                </>
              }
              tone={person.conflict === null ? 'plain' : 'selected'}
              trailing={
                person.owner ? (
                  <span className="text-sm text-ink-muted">Everything</span>
                ) : (
                  renderAction(person.action, person.name)
                )
              }
            />
          ))}
        </ul>
      </ListCard>
      <section className="flex flex-col gap-3">
        <h2 className={eyebrowClass}>Roles, highest first</h2>
        <ul className="flex flex-wrap gap-2">
          {people.roles.map((role) => (
            <li key={role.id}>
              <Link
                href={role.href}
                scroll={false}
                aria-current={role.selected ? 'true' : undefined}
                className={cn(
                  buttonClass(role.selected ? 'primary' : 'secondary'),
                  'no-underline hover:no-underline',
                )}
              >
                {role.name}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-muted">
          You can give out roles below your own. A person with two roles can do
          what either allows.
        </p>
      </section>
    </HostShell>
  );
}
