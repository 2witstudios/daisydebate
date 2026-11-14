import Link from 'next/link';
import type { RoomSeat, WaitingRoom as Read } from '../../../features/tab/room';
import { cn } from '../../cn';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ActionButton, ActionLink } from '../action-control/action-control';
import { ListCard, ListHeading } from '../list-card/list-card';

const tones: Readonly<Record<RoomSeat['tone'], string>> = {
  sky: 'bg-hue-sky-soft text-hue-sky',
  clay: 'bg-hue-clay-soft text-hue-clay',
  teal: 'bg-hue-teal-soft text-hue-teal',
  neutral: 'bg-surface-overlay text-ink-muted',
};

/** The disc that marks a seat: a side's letters, a count of judges, a speaking place. */
export const seatMarkClass = (tone: RoomSeat['tone']): string =>
  `inline-flex size-avatar-lg shrink-0 items-center justify-center rounded-full text-sm font-heavy ${tones[tone]}`;

function Seat({ seat }: { readonly seat: RoomSeat }) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span aria-hidden="true" className={seatMarkClass(seat.tone)}>
        {seat.mark}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p>
          <strong className="font-strong">{seat.name}</strong>
          {seat.members === null ? null : (
            <span className="text-ink-muted"> · {seat.members}</span>
          )}
        </p>
        <p className="text-sm text-ink-muted">{seat.role}</p>
      </div>
      {seat.action === null ? (
        seat.status === null ? null : (
          <span
            className={cn(
              'text-sm whitespace-nowrap',
              seat.here ? 'font-strong text-accent' : 'text-ink-muted',
            )}
          >
            {seat.status}
          </span>
        )
      ) : (
        <ActionButton action={seat.action} />
      )}
    </li>
  );
}

/**
 * A Room before its Round starts, in any seat arrangement: a panel, a speech
 * section, four sides or an open conversation. An event Room shows what was
 * pinned at publish and the lobby that set it; nothing here can be edited in
 * the Room.
 */
export function WaitingRoom({ room }: { readonly room: Read }) {
  return (
    <ReadingPage>
      <Link
        href={room.back.href}
        className="self-start font-strong text-ink underline"
      >
        {room.back.label}
      </Link>
      <PageHeader title={room.title} lede={room.lede} />
      <ListCard label="Seats">
        <ul>
          {room.seats.map((seat) => (
            <Seat key={`${seat.mark} ${seat.name}`} seat={seat} />
          ))}
        </ul>
      </ListCard>
      {room.runOfShow === null ? null : (
        <ListCard label="Run of show">
          <ListHeading>{room.runOfShow.heading}</ListHeading>
          <ol>
            {room.runOfShow.steps.map((step, index) => (
              <li
                key={step.title}
                className="flex items-center gap-4 border-b border-border px-4 py-3"
              >
                <span className="text-ink-muted tabular-nums">{index + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <strong className="font-strong">{step.title}</strong>
                  <span className="text-sm text-ink-muted">{step.detail}</span>
                </div>
                <span className="text-sm whitespace-nowrap tabular-nums">
                  {step.length}
                </span>
              </li>
            ))}
          </ol>
          <p className="px-4 py-3 text-sm text-ink-muted">
            {room.runOfShow.note}
          </p>
        </ListCard>
      )}
      <Primary room={room} />
      {room.pinned === null ? null : (
        <>
          <ListCard>
            <ListHeading>Set by {room.pinned.setBy}</ListHeading>
            <dl className="grid grid-cols-pinned gap-x-4 gap-y-2 px-4 py-3 text-sm">
              {room.pinned.lines.map((line) => (
                <div key={line.label} className="contents">
                  <dt className="text-ink-muted">{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          </ListCard>
        </>
      )}
      {room.help === null ? null : (
        <p className="text-sm text-ink-muted">
          {room.help.text} <ActionLink action={room.help.action} />
        </p>
      )}
    </ReadingPage>
  );
}

function Primary({ room }: { readonly room: Read }) {
  return (
    <div className="flex flex-col gap-2">
      <ActionButton action={room.primary} />
      {room.primaryNote === null ? null : (
        <p className="text-center text-sm text-ink-muted">{room.primaryNote}</p>
      )}
    </div>
  );
}
