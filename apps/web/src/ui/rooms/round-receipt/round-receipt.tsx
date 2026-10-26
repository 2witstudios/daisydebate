import type { RoundView } from '@daisy/protocol';
import type { ReactNode } from 'react';
import { seatLabel } from '../room-page/assembly-controls';
import { clockDuration } from '../../../features/rooms/duration-input';
import { ruleRows, speechName } from '../../../features/debate-room/vocabulary';
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
  scheduled: 'Not started',
  active: 'In progress',
  completed: 'Finished',
  abandoned: 'Closed',
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

/** The frozen rules in the room's words. */
const settingRows = (round: RoundReceiptView) => {
  const { interaction } = round.rules;
  return ruleRows({
    preRoundPrepMs: round.config.preRoundPrep.enabled
      ? round.config.preRoundPrep.durationMs
      : null,
    prepPerSideMs: round.rules.inRoundPrep?.budgetMsPerSide ?? null,
    countdownMs: round.rules.countdownMs,
    crossExMode: interaction.crossExMode,
    interruptions: interaction.interruptions && {
      mode: interaction.interruptions.allowed,
      minRemainingMs: interaction.interruptions.minRemainingMs,
    },
    yielding: interaction.yield,
  });
};

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

/**
 * A receipt of the round as it started and, once the ballot lands, the
 * result. `children` (the decision, coaching and transcript) follow the
 * result, ahead of the cast and settings.
 */
export function RoundReceipt({
  round,
  children,
}: {
  readonly round: RoundReceiptView;
  readonly children?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm text-ink-muted">
          Round · {statusLabel[round.status]}
        </p>
        <h1 className="font-display text-2xl font-semibold text-ink">
          Round result
        </h1>
        {round.outcome || round.status === 'completed' ? (
          <p className="text-lg font-strong text-ink">
            Result · {resultText(round)}
          </p>
        ) : null}
        <p className="text-ink-muted">Media is not available yet.</p>
        <section
          aria-labelledby="receipt-resolution"
          className="mt-4 rounded-xl border border-border bg-surface-raised p-5"
        >
          <h2
            id="receipt-resolution"
            className="text-xs font-bold tracking-wide text-ink-muted uppercase"
          >
            Resolution
          </h2>
          <p className="font-display text-xl wrap-anywhere">{round.topic}</p>
        </section>
        <MediaPageLink href={`/rooms/${round.roomId}`}>
          Return to room
        </MediaPageLink>
      </header>
      {children}
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
        <h2 className="font-strong">Settings when the round started</h2>
        <dl className="flex flex-col gap-2 text-sm">
          {settingRows(round).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
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
              {speechName(segment)} · {seatLabel(segment.side, segment.slot)} ·{' '}
              {clockDuration(segment.durationMs)}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
