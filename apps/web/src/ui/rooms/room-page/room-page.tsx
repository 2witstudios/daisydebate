import Link from 'next/link';
import type { RoomView } from '../../../features/rooms/view';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { DemoControls } from '../../components/demo-controls/demo-controls';
import { Notice } from '../../components/notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import type { MockFormAction } from '../../form-action/mock-form';
import { cn } from '../../cn';
import { RoomSettingsForm } from '../settings-form/room-settings-form';
import { SeatCard } from './seat-card';

const linkButton = 'no-underline hover:no-underline';
const noticeIcon = {
  accent: 'check',
  gold: 'alert',
  neutral: 'alert',
} as const;
const panel = 'flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-1';

function Denied({
  view,
}: {
  readonly view: Extract<RoomView, { kind: 'denied' }>;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:px-4">
      <PageHeader title="You cannot see this room" />
      <Notice tone="neutral" icon="key" title="This room is private">
        Only people the host invited can open it. Open tables you can join are
        in the lobby.
      </Notice>
      <Link
        href={view.lobbyHref}
        className={cn(buttonClass('primary'), linkButton, 'w-fit')}
      >
        Back to the lobby
      </Link>
    </div>
  );
}

type RoomOf = Extract<RoomView, { kind: 'room' }>;

function ReadyControl({
  ready,
}: {
  readonly ready: NonNullable<RoomOf['ready']>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-md font-strong text-ink">Are you ready?</h2>
      {ready.href ? (
        <Link
          href={ready.href}
          className={cn(
            buttonClass(ready.label === 'Ready' ? 'primary' : 'secondary'),
            linkButton,
            'w-fit',
          )}
        >
          {ready.label === 'Ready' ? 'I am ready' : 'Not ready'}
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className={cn(buttonClass('secondary'), 'w-fit')}
        >
          I am ready
        </button>
      )}
      {ready.note ? (
        <p className="text-sm text-ink-muted">{ready.note}</p>
      ) : null}
    </div>
  );
}

function StartControl({
  start,
}: {
  readonly start: NonNullable<RoomOf['start']>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-md font-strong text-ink">Start the debate</h2>
      {start.href ? (
        <Link
          href={start.href}
          className={cn(buttonClass('primary'), linkButton, 'w-fit')}
        >
          Start debate
        </Link>
      ) : (
        <button
          type="button"
          disabled
          className={cn(buttonClass('primary'), 'w-fit')}
        >
          Start debate
        </button>
      )}
      {start.blockedBy ? (
        <p className="text-sm text-ink-muted">{start.blockedBy}</p>
      ) : null}
    </div>
  );
}

function Controls({ view }: { readonly view: RoomOf }) {
  const { ready, start, debateHref } = view;
  if (ready === null && start === null && debateHref === null) return null;
  return (
    <section aria-label="Your controls" className={panel}>
      {ready ? <ReadyControl ready={ready} /> : null}
      {start ? <StartControl start={start} /> : null}
      {debateHref ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-md font-strong text-ink">
            The debate has started
          </h2>
          <Link
            href={debateHref}
            className={cn(buttonClass('primary'), linkButton, 'w-fit')}
          >
            Open the debate
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function Settings({
  view,
  settingsAction,
}: {
  readonly view: Extract<RoomView, { kind: 'room' }>;
  readonly settingsAction: MockFormAction;
}) {
  return (
    <section aria-label="Room settings" className={panel}>
      <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Settings
      </h2>
      <dl className="flex flex-col gap-2 text-base">
        {view.settings.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className="text-right font-strong text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      {view.host ? (
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-strong text-ink">Who judges</p>
            <ul className="flex flex-wrap gap-2">
              {view.host.judgeChoices.map((choice) => (
                <li key={choice.label}>
                  <Link
                    href={choice.href}
                    aria-current={choice.on ? 'true' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center rounded-sm border px-4 text-base font-strong no-underline hover:no-underline',
                      choice.on
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-border-strong text-ink',
                    )}
                  >
                    {choice.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <RoomSettingsForm action={settingsAction} speech={4} prep={2} />
          <Link
            href={view.host.closeHref}
            className={cn(buttonClass('ghost'), linkButton, 'w-fit')}
          >
            Close room
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The room: who holds each seat, what each person can do, the settings, and
 * the controls to ready up and start. Every control is a link to the next
 * state of the room; nothing is kept.
 */
export function RoomPage({
  view,
  settingsAction,
}: {
  readonly view: RoomView;
  readonly settingsAction: MockFormAction;
}) {
  if (view.kind === 'denied') return <Denied view={view} />;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <Link
        href={view.lobbyHref}
        className="inline-flex min-h-10 w-fit items-center gap-2 text-base font-strong text-ink-muted no-underline hover:text-ink hover:no-underline"
      >
        <span aria-hidden="true">&lsaquo;</span>
        Lobby
      </Link>
      <PageHeader
        title={view.title}
        lede={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={view.modeLabel === 'Ranked' ? 'gold' : 'neutral'}>
              {view.modeLabel}
            </Badge>
            <Badge
              tone={
                view.status.tone === 'neutral' ? 'neutral' : view.status.tone
              }
            >
              {view.status.label}
            </Badge>
          </span>
        }
      />
      {view.notice ? (
        <Notice
          tone={view.notice.tone}
          icon={noticeIcon[view.notice.tone]}
          title={view.notice.text}
          role="status"
        />
      ) : null}
      {view.reopenedNote ? (
        <Notice tone="accent" icon="check" title="Rematch" role="status">
          {view.reopenedNote}
        </Notice>
      ) : null}
      {view.closed ? (
        <Notice tone="neutral" icon="key" title="This room is closed">
          Nobody can take a seat. Open tables are in the lobby.
        </Notice>
      ) : null}
      <div className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-6 max-compact:w-full max-compact:gap-4">
          <ul aria-label="Seats" className="grid grid-cols-1 gap-4">
            {view.seats.map((seat) => (
              <SeatCard key={seat.id} seat={seat} />
            ))}
          </ul>
          <Controls view={view} />
        </div>
        <aside
          aria-label="About this room"
          className="flex w-rail shrink-0 flex-col gap-4 max-compact:w-full"
        >
          <Settings view={view} settingsAction={settingsAction} />
          <DemoControls
            blurb="This room has no backend. These stand in for other people acting in it."
            items={view.demo}
          />
        </aside>
      </div>
    </div>
  );
}
