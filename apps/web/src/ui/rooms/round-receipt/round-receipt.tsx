import Link from 'next/link';
import type { RoundView } from '@daisy/protocol';
import { seatLabel } from '../room-page/assembly-controls';

export type RoundReceiptView = Pick<
  RoundView,
  'id' | 'roomId' | 'status' | 'topic' | 'participants'
> & {
  readonly config: Pick<RoundView['config'], 'preRoundPrep'>;
  readonly rules: Pick<
    RoundView['rules'],
    'segments' | 'countdownMs' | 'inRoundPrep' | 'interaction'
  >;
};

const duration = (ms: number) => {
  const seconds = ms / 1000;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** A receipt of durable Launch, with no invented floor, media or outcome. */
export function RoundReceipt({ round }: { readonly round: RoundReceiptView }) {
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm text-ink-muted">
          Round · {round.status === 'scheduled' ? 'Scheduled' : round.status}
        </p>
        <h1 className="text-2xl font-strong text-ink">{round.topic}</h1>
        <p className="text-ink-muted">
          Media and judging are not available yet.
        </p>
        <Link href={`/rooms/${round.roomId}`}>Return to room</Link>
      </header>
      <section
        aria-label="Frozen cast"
        className="rounded-xl bg-surface p-6 shadow-1"
      >
        <h2 className="font-strong">Participants</h2>
        <ul>
          {round.participants.map((participant) => (
            <li key={participant.id}>
              {seatLabel(participant.role, participant.slot)} ·{' '}
              {participant.label}
              {participant.kind === 'bot' ? ' · AI' : ''}
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
