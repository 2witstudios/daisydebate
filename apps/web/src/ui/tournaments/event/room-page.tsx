import type {
  RoomAction,
  RoomScreen,
  Seat,
} from '../../../features/tournaments/room';
import type { Tournament } from '../../../features/tournaments/tournament';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { formatTime } from '../../../features/tournaments/dates';
import { Badge } from '../../components/badge/badge';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { DisabledAction, SampleButton } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { Notice } from '../notice/notice';
import { PageFrame } from '../page-frame/page-frame';
import { Person } from '../person/person';
import { FactList } from '../fact-list/fact-list';
import { cn } from '../../cn';

const seatCard =
  'flex flex-1 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4';
const label = 'text-xs font-bold tracking-wider text-ink-faint uppercase';

function SeatCard({ seat }: { readonly seat: Seat }) {
  return (
    <div className={seatCard}>
      <p className={label}>{seat.side}</p>
      <Person handle={seat.handle} you={seat.you} />
      <p className="text-sm text-ink-muted">{seat.detail}</p>
      <p
        className={cn(
          'text-sm font-strong',
          seat.status === 'Ready' ? 'text-online' : 'text-ink-muted',
        )}
      >
        {seat.status}
      </p>
    </div>
  );
}

function Action({ action }: { readonly action: RoomAction }) {
  switch (action.kind) {
    case 'ready':
      return (
        <LinkButton href={action.href} variant="primary">
          I am ready
        </LinkButton>
      );
    case 'waiting':
      return (
        <p className="text-base text-ink-muted">
          {`Waiting for @${action.opponent} to be ready. The debate starts as soon as both debaters are ready.`}
        </p>
      );
    case 'starting':
      return (
        <p role="status" className="text-lg font-strong text-ink">
          {`Starting in ${action.seconds} seconds`}
        </p>
      );
    case 'absent':
      return (
        <div className="flex flex-col gap-3">
          <Notice icon="clock">
            {`@${action.opponent} has not checked in. You can claim a forfeit at ${action.claimAt}, 10 minutes after the start. The organizer confirms it.`}
          </Notice>
          <div className="flex flex-wrap gap-3">
            <DisabledAction
              label={`Claim forfeit (available ${action.claimAt})`}
              reason="Forfeits are confirmed by the organizer."
              variant="primary"
            />
            <SampleButton label="Contact the organizer" variant="ghost" />
          </div>
        </div>
      );
  }
}

export type RoomPageProps = {
  readonly screen: RoomScreen;
  readonly tournament: Tournament;
  readonly startsAt: string;
};

/** The tournament pairing room: seats and judge fixed, readiness live. */
export function RoomPage({ screen, tournament, startsAt }: RoomPageProps) {
  return (
    <PageFrame>
      <div className="flex flex-col gap-3">
        <Breadcrumb
          trail={[
            {
              label: tournament.name,
              href: tournamentRoutes.myEvent(tournament.id),
            },
            { label: screen.title.replace(' room', '') },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            {screen.title}
          </h1>
          <Badge>Tournament debate</Badge>
        </div>
      </div>
      <div className="flex items-start gap-6 max-rail:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-rail:w-full">
          <div className="flex gap-3 max-compact:flex-col">
            {screen.seats.map((seat) => (
              <SeatCard key={seat.side} seat={seat} />
            ))}
          </div>
          <div className={seatCard}>
            <p className={label}>Judge</p>
            <Person handle={screen.judge} />
            <p className="text-sm text-ink-muted">
              In the room. Assigned by Daisy. Rating hidden while judging.
            </p>
          </div>
          <div
            aria-live="polite"
            className="rounded-xl bg-surface p-6 shadow-1"
          >
            <Action action={screen.action} />
          </div>
        </div>
        <aside
          aria-label="Rules for this debate"
          className="flex w-rail shrink-0 flex-col gap-3 rounded-xl bg-surface p-6 shadow-1 max-rail:w-full"
        >
          <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
            Rules for this debate
          </h2>
          <p className="text-base text-ink-muted">
            Standard rules, the same as Ranked. The tournament adds no custom
            rules.
          </p>
          <Badge tone="accent">Unrated</Badge>
          <FactList
            facts={[
              ['Starts', `${formatTime(startsAt)} UTC`],
              ['Judges', 'One, fixed by the pairing'],
              ['Seats', 'Fixed by the pairing. No swaps.'],
              ['Spectators', `${screen.watching} watching, public`],
            ]}
          />
        </aside>
      </div>
    </PageFrame>
  );
}
