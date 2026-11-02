'use client';

import type { OnlineMember } from '@daisy/protocol';
import Link from 'next/link';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { Avatar } from '../components/avatar/avatar';
import { statusLabels } from '../components/presence-dot/status-labels';
import { Icon } from '../components/icon/icon';
import { cn } from '../cn';
import { MemberCardBody, ratingsLabel } from './member-card';
import { outgoingTo, PersonMenu } from './person-menu';
import { useOnline } from './online-provider';
import type { PersonActions } from './person-actions';

const LONG_PRESS_MS = 500;
/** About the tallest the menu grows, so it never opens past the rail's foot. */
const MENU_HEIGHT = 408;

/** What a row reads under the name: a sent offer or request, otherwise the status. */
export const rowDetail = (member: OnlineMember, challengeSent: boolean) =>
  challengeSent
    ? 'Challenge sent'
    : member.relation === 'outgoing'
      ? 'Friend request sent'
      : statusLabels[member.status];

type Anchored = { readonly username: string; readonly top: number };

/**
 * The hover card and menu shared by the open list, the collapsed avatars and
 * the phone's list, anchored in `container`. Long press stays touch only, so a
 * mouse keeps text selection and a press never races a scroll.
 */
export function usePersonOverlay(
  container: RefObject<HTMLElement | null>,
  actions: PersonActions,
) {
  const { roster } = useOnline();
  const [hover, setHover] = useState<Anchored | null>(null);
  const [menu, setMenu] = useState<Anchored | null>(null);
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
  const rowProps = (username: string) => ({
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      clearPress();
      setHover(null);
      setMenu({ username, top: topOf(event.currentTarget, MENU_HEIGHT) });
    },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') return;
      const element = event.currentTarget;
      clearPress();
      press.current = setTimeout(
        () => setMenu({ username, top: topOf(element, MENU_HEIGHT) }),
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
  const open = (username: string, element: Element) => {
    setHover(null);
    setMenu({ username, top: topOf(element, MENU_HEIGHT) });
  };
  const memberOf = (name: string | undefined) =>
    roster.members.find((member) => member.username === name);
  const hovered = memberOf(hover?.username);
  const opened = memberOf(menu?.username);
  const overlay = (
    <>
      {hovered && !opened ? (
        <div
          style={{ top: hover?.top }}
          className="pointer-events-none absolute right-full z-20 mr-2 flex w-person-card flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-3 max-compact:hidden"
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
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
  return { rowProps, open, overlay, menuName: opened?.username ?? null };
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
  readonly member: OnlineMember;
  readonly overlay: ReturnType<typeof usePersonOverlay>;
  readonly active: boolean;
}) {
  const { challenges } = useOnline();
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
        <span className="truncate text-sm leading-tight font-semibold text-ink">
          @{member.username}
        </span>
        <span className="truncate text-xs leading-tight text-ink-muted">
          {detail}
        </span>
      </Link>
      <Link
        href={href}
        aria-label={`Actions for @${member.username}`}
        aria-haspopup="menu"
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

/** The list: friends first, then everyone, as one scrolling column. */
export function PersonList({
  overlay,
  className,
}: {
  readonly overlay: ReturnType<typeof usePersonOverlay>;
  readonly className?: string;
}) {
  const { roster, loadMore, filter } = useOnline();
  const friends = roster.members.filter((m) => m.relation === 'friends');
  const others = roster.members.filter((m) => m.relation !== 'friends');
  const section = (title: string, members: readonly OnlineMember[]) =>
    members.length === 0 ? null : (
      <>
        <li>
          <h3 className={headClass}>{title}</h3>
        </li>
        {members.map((member) => (
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
      {filter === 'all' ? section('Everyone', others) : null}
      {roster.members.length === 0 ? (
        <li role="status" className="px-3 py-6 text-center font-semibold">
          No one matches
        </li>
      ) : null}
      {roster.nextCursor ? (
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
