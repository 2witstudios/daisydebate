import type { RoundView } from '@daisy/protocol';
import { seatLabel } from '../room-page/assembly-controls';
import { MediaPageLink } from '../../round-media/media-page-link';

export type RoundReceiptView = Pick<
  RoundView,
  | 'id'
  | 'roomId'
  | 'status'
  | 'topic'
  | 'participants'
  | 'outcome'
  | 'unjudgedRuling'
> & {
  readonly config: Pick<RoundView['config'], 'preRoundPrep'>;
  readonly rules: Pick<
    RoundView['rules'],
    'segments' | 'countdownMs' | 'inRoundPrep' | 'interaction'
  >;
};

const statusLabel: Readonly<Record<RoundView['status'], string>> = {
  scheduled: 'Scheduled',
  active: 'Active',
  completed: 'Completed',
  abandoned: 'Abandoned',
};

/**
 * No outcome: an incomplete transcript no AI judge may rule on (DEC-208), no
 * judges, or judges who did not rule by the deadline (DEC-201).
 */
const resultText = (round: RoundReceiptView) =>
  round.outcome
    ? resultLabel[round.outcome]
    : round.unjudgedRuling === 'transcript-incomplete'
      ? 'Transcript incomplete'
      : round.participants.some((seat) => seat.role === 'judge')
        ? 'Judges did not rule'
        : 'Unjudged';
const resultLabel: Readonly<Record<NonNullable<RoundView['outcome']>, string>> =
  {
    affirmative: 'Affirmative won',
    negative: 'Negative won',
    draw: 'Draw',
  };

type Participant = RoundReceiptView['participants'][number];

/**
 * A seat's line. A human judge stays anonymous until both debaters have
 * reviewed the ballot, which nothing records yet (DEC-98).
 */
const participantLine = (participant: Participant) => {
  const seat = seatLabel(participant.role, participant.slot);
  if (
    'anonymous' in participant ||
    (participant.role === 'judge' && participant.kind === 'human')
  )
    return seat;
  return `${seat} · ${participant.label}${participant.kind === 'bot' ? ' · AI' : ''}`;
};

const duration = (ms: number) => {
  const seconds = ms / 1000;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** A receipt of durable Launch and, once the ballot lands, the result. */
export function RoundReceipt({ round }: { readonly round: RoundReceiptView }) {
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm text-ink-muted">
          Round · {statusLabel[round.status]}
        </p>
        <h1 className="text-2xl font-strong text-ink">{round.topic}</h1>
        {round.outcome || round.status === 'completed' ? (
          <p className="text-lg font-strong text-ink">
            Result · {resultText(round)}
          </p>
        ) : null}
        <p className="text-ink-muted">Media is not available yet.</p>
        <MediaPageLink href={`/rooms/${round.roomId}`}>
          Return to room
        </MediaPageLink>
      </header>
      <section
        aria-label="Frozen cast"
        className="rounded-xl bg-surface p-6 shadow-1"
      >
        <h2 className="font-strong">Participants</h2>
        <ul>
          {round.participants.map((participant) => (
            <li key={`${participant.role}-${participant.slot}`}>
              {participantLine(participant)}
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-label="Frozen settings"
        className="rounded-xl bg-surface p-6 shadow-1"
      >
        <h2 className="font-strong">Settings at Launch</h2>
        <dl>
          <dt>Pre-round preparation</dt>
          <dd>
            {round.config.preRoundPrep.enabled
              ? duration(round.config.preRoundPrep.durationMs)
              : 'Disabled'}
          </dd>
          <dt>In-round preparation per side</dt>
          <dd>
            {round.rules.inRoundPrep
              ? duration(round.rules.inRoundPrep.budgetMsPerSide)
              : 'Disabled'}
          </dd>
          <dt>Countdown</dt>
          <dd>{duration(round.rules.countdownMs)}</dd>
          <dt>Cross-examination</dt>
          <dd>{round.rules.interaction.crossExMode}</dd>
          <dt>Interruptions</dt>
          <dd>
            {round.rules.interaction.interruptions?.allowed ??
              'Unavailable in this format'}
          </dd>
          <dt>Yielding</dt>
          <dd>
            {round.rules.interaction.yield?.allowed ? 'Allowed' : 'Disabled'}
          </dd>
        </dl>
      </section>
      <section
        aria-label="Frozen speech schedule"
        className="rounded-xl bg-surface p-6 shadow-1"
      >
        <h2 className="font-strong">Speech schedule</h2>
        <ol>
          {round.rules.segments.map((segment) => (
            <li key={segment.key}>
              {segment.label} · {seatLabel(segment.side, segment.slot)} ·{' '}
              {duration(segment.durationMs)}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
