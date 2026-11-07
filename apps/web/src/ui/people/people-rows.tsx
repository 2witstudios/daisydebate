'use client';

import type { Person } from '@daisy/protocol';
import { ShellLink as Link } from '../layout/app-shell/shell-link';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { Avatar } from '../components/avatar/avatar';
import { statusLabels } from '../components/presence-dot/status-labels';
import { Icon } from '../components/icon/icon';
import { cn } from '../cn';
import { anchorAt, MemberCardBody, ratingsLabel } from './member-card';
import { outgoingTo, PersonMenu } from './person-menu';
import { useChallenges } from '../challenges/challenge-provider';
import { usePeople } from './people-provider';
import type { PersonActions } from './person-actions';

const LONG_PRESS_MS = 500;
/** About the tallest the menu grows, so it never opens past the rail's foot. */
const MENU_HEIGHT = 408;

/** What a row reads under the name: a sent offer or request, otherwise the status. */
export const rowDetail = (member: Person, challengeSent: boolean) =>
  challengeSent
    ? 'Challenge sent'
    : member.relation === 'outgoing'
      ? 'Friend request sent'
      : statusLabels[member.status];

type Anchored = { readonly username: string; readonly top: number };
/** The person as they were on opening, so leaving never closes a report. */
type OpenMenu = Anchored & { readonly member: Person };

/**
 * The hover card and menu shared by the open list, the collapsed avatars and
 * the phone's list, anchored in `container`. Long press stays touch only, so a
 * mouse keeps text selection and a press never races a scroll.
 */
export function usePersonOverlay(
  container: RefObject<HTMLElement | null>,
  actions: PersonActions,
) {
  const { list } = usePeople();
  const [hover, setHover] = useState<Anchored | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topOf = (element: Element, tallest: number) => {
    const box = container.current?.getBoundingClientRect();
    if (!box) return 0;
    const top = element.getBoundingClientRect().top - box.top;
    return Math.max(8, Math.min(top, box.height - tallest));
  };
  const clearPress = useCallback(() => {
    if (press.current !== null) clearTimeout(press.current);
    press.current = null;
  }, []);
  const memberOf = (name: string | undefined) =>
    list.people.find((member) => member.username === name);
  const openAt = (username: string, element: HTMLElement) => {
    const member = memberOf(username);
    if (!member) return;
    trigger.current = element;
    clearPress();
    setHover(null);
    setMenu({ username, member, top: topOf(element, MENU_HEIGHT) });
  };
  const closeMenu = useCallback(() => {
    setMenu(null);
    trigger.current?.focus();
  }, []);
  const rowProps = (username: string) => ({
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      openAt(username, event.currentTarget);
    },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') return;
      const element = event.currentTarget;
      clearPress();
      press.current = setTimeout(
        () => openAt(username, element),
        LONG_PRESS_MS,
      );
    },
    onPointerUp: clearPress,
    onPointerLeave: clearPress,
    onPointerCancel: clearPress,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) =>
      setHover({ username, top: topOf(event.currentTarget, 96) }),
    onMouseLeave: () => setHover(null),
    onFocus: (event: React.FocusEvent<HTMLElement>) =>
      setHover({ username, top: topOf(event.currentTarget, 96) }),
    onBlur: () => setHover(null),
  });
  const hovered = memberOf(hover?.username);
  const opened = menu ? (memberOf(menu.username) ?? menu.member) : undefined;
  const overlay = (
    <>
      {hovered && !opened ? (
        <div
          ref={anchorAt(hover?.top ?? 0)}
          className="pointer-events-none absolute person-anchor right-full z-20 mr-2 flex w-person-card flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-3 max-compact:hidden"
        >
          <MemberCardBody member={hovered} />
        </div>
      ) : null}
      {opened && menu ? (
        <PersonMenu
          member={opened}
          actions={actions}
          reported={reported.has(opened.username)}
          onReported={() =>
            setReported((current) => new Set([...current, opened.username]))
          }
          top={menu.top}
          onClose={closeMenu}
        />
      ) : null}
    </>
  );
  return {
    rowProps,
    open: openAt,
    overlay,
    menuName: opened?.username ?? null,
  };
}

/**
 * A row: avatar, name and status, and three dots. The dots are a link to the
 * profile, which carries every action as a form, so a row works without script;
 * hydrated, they open the menu instead.
 */
function PersonRow({
  member,
  overlay,
  active,
}: {
  readonly member: Person;
  readonly overlay: ReturnType<typeof usePersonOverlay>;
  readonly active: boolean;
}) {
  const { challenges } = useChallenges();
  const detail = rowDetail(
    member,
    Boolean(outgoingTo(challenges, member.username)),
  );
  const href = `/profile/${member.username}`;
  return (
    <div
      {...overlay.rowProps(member.username)}
      data-open={active}
      className={cn(
        'group flex min-h-tab items-center gap-2 pr-1 pl-3 select-none hover:bg-surface-overlay',
        active && 'bg-surface-overlay',
      )}
    >
      <Avatar
        name={member.username}
        presence={member.status}
        size="sm"
        nameVisible
      />
      <Link
        href={href}
        aria-label={`@${member.username}, ${detail}, ${ratingsLabel(member)}`}
        onClick={(event) => {
          event.preventDefault();
          overlay.open(member.username, event.currentTarget);
        }}
        className="flex min-h-nav-target min-w-0 flex-1 flex-col justify-center no-underline hover:no-underline"
      >
        <span
          className={cn(
            'truncate text-sm leading-tight font-semibold',
            member.status === 'offline' ? 'text-ink-muted' : 'text-ink',
          )}
        >
          @{member.username}
        </span>
        <span className="truncate text-xs leading-tight text-ink-muted">
          {detail}
        </span>
      </Link>
      <Link
        href={href}
        aria-label={`Actions for @${member.username}`}
        aria-haspopup="dialog"
        title="More"
        onClick={(event) => {
          event.preventDefault();
          overlay.open(member.username, event.currentTarget);
        }}
        className={cn(
          'flex h-nav-target w-8 shrink-0 items-center justify-center rounded-sm text-ink-muted group-focus-within:opacity-100 group-hover:opacity-100 hover:text-ink pointer-coarse:opacity-100',
          active ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Icon name="dots" size={18} />
      </Link>
    </div>
  );
}

const headClass =
  'px-3 pt-2 pb-1 text-xs font-bold tracking-wide text-ink-muted uppercase';

/** The list: friends, then others online, then others offline, as one column. */
export function PersonList({
  overlay,
  className,
}: {
  readonly overlay: ReturnType<typeof usePersonOverlay>;
  readonly className?: string;
}) {
  const { list, loadMore, filter } = usePeople();
  const friends = list.people.filter((m) => m.relation === 'friends');
  const others = list.people.filter((m) => m.relation !== 'friends');
  const online = others.filter((m) => m.status !== 'offline');
  const offline = others.filter((m) => m.status === 'offline');
  const section = (title: string, people: readonly Person[]) =>
    people.length === 0 ? null : (
      <>
        <li>
          <h3 className={headClass}>{title}</h3>
        </li>
        {people.map((member) => (
          <li key={member.username}>
            <PersonRow
              member={member}
              overlay={overlay}
              active={overlay.menuName === member.username}
            />
          </li>
        ))}
      </>
    );
  return (
    <ul className={cn('flex list-none flex-col overflow-y-auto', className)}>
      {section('Friends', friends)}
      {filter === 'all' ? section('Online', online) : null}
      {filter === 'all' ? section('Offline', offline) : null}
      {list.people.length === 0 ? (
        <li>
          <p role="status" className="px-3 py-6 text-center font-semibold">
            No one matches
          </p>
        </li>
      ) : null}
      {list.nextCursor ? (
        <li>
          <button
            type="button"
            onClick={loadMore}
            className="min-h-nav-target w-full text-sm font-semibold text-ink-muted hover:text-ink"
          >
            Show more
          </button>
        </li>
      ) : null}
    </ul>
  );
}
