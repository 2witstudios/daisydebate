import { isJudgeSeat, seatKey, type RoundView } from '@daisy/protocol';
import type { ReactNode } from 'react';
import { seatLabel, segmentSeatLabel } from '../room-page/assembly-controls';
import { sideName } from '../../../features/debate-room/seat-names';
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
  | 'panelRuling'
  | 'platformEnding'
> & {
  readonly resolutionAudit?: RoundView['resolutionAudit'];
  readonly config: Pick<RoundView['config'], 'preRoundPrep'>;
  readonly rules: Pick<
    RoundView['rules'],
    'sides' | 'segments' | 'countdownMs' | 'inRoundPrep' | 'interaction'
  >;
};

const statusLabel: Readonly<Record<RoundView['status'], string>> = {
  opening: 'Starting',
  active: 'In progress',
  completed: 'Finished',
  abandoned: 'Closed',
};

/**
 * No outcome: an incomplete transcript no AI judge may rule on (DEC-208), no
 * judges, or judges who did not rule by the deadline (DEC-201).
 */
const resultText = (round: RoundReceiptView) =>
  round.platformEnding
    ? 'Ended by a Daisy server failure. No result, no rating and no charge.'
    : round.outcome
      ? outcomeText(round.rules.sides, round.outcome)
      : round.panelRuling === 'transcript-incomplete'
        ? 'Transcript incomplete'
        : round.panelRuling === 'judging-failed'
          ? 'AI judge could not rule'
          : round.panelRuling === 'judges-split'
            ? 'Judges split'
            : round.participants.some((seat) => isJudgeSeat(seat.seat))
              ? 'Judges did not rule'
              : 'Unjudged';

/** "Affirmative won"; a ranking reads its places in order. */
const outcomeText = (
  sides: RoundReceiptView['rules']['sides'],
  outcome: NonNullable<RoundView['outcome']>,
): string => {
  switch (outcome.kind) {
    case 'winner':
      return `${sideName(sides, outcome.side)} won`;
    case 'ranking':
      return outcome.of === 'sides'
        ? `Ranked ${outcome.places
            .map((place) =>
              place.map((key) => sideName(sides, key)).join(' and '),
            )
            .join(', then ')}`
        : 'Speakers ranked';
  }
};

type Participant = RoundReceiptView['participants'][number];

/** The frozen rules in the room's words. */
const settingRows = (round: RoundReceiptView) => {
  const { interaction } = round.rules;
  const { interruptions } = interaction;
  return ruleRows({
    preRoundPrepMs: round.config.preRoundPrep.enabled
      ? round.config.preRoundPrep.durationMs
      : null,
    prepPerSideMs: round.rules.inRoundPrep?.budgetMsPerSide ?? null,
    countdownMs: round.rules.countdownMs,
    interruptions:
      interruptions.allowed === 'enabled'
        ? {
            mode: interruptions.allowed,
            minRemainingMs: interruptions.minRemainingMs,
          }
        : { mode: interruptions.allowed },
    yielding: interaction.yield,
  });
};

/**
 * A seat's line. A human judge stays anonymous until both debaters have
 * reviewed the ballot, which nothing records yet (DEC-98).
 */
const participantLine = (
  sides: RoundReceiptView['rules']['sides'],
  participant: Participant,
) => {
  const seat = seatLabel(sides, participant.seat);
  if (
    'anonymous' in participant ||
    (isJudgeSeat(participant.seat) && participant.kind === 'human')
  )
    return seat;
  return `${seat} · ${participant.label}${participant.kind === 'bot' ? ' · AI' : ''}`;
};

/**
 * A receipt of the round as it started and, once the ballot lands, the
 * result. `children` (the decision and transcript, then the round analysis) follow the
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
        {round.outcome ||
        round.status === 'completed' ||
        round.platformEnding ? (
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
          <p className="font-display text-xl wrap-anywhere">
            {round.topic ?? 'Not chosen'}
          </p>
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
            <li key={seatKey(participant.seat)}>
              {participantLine(round.rules.sides, participant)}
            </li>
          ))}
        </ul>
      </section>
      {round.resolutionAudit ? (
        <DrawAudit audit={round.resolutionAudit} sides={round.rules.sides} />
      ) : null}
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
              {speechName(segment)} ·{' '}
              {segmentSeatLabel(round.rules.sides, segment.speak)} ·{' '}
              {clockDuration(segment.durationMs)}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

const strikeWho: Readonly<Record<'debater' | 'timeout' | 'automatic', string>> =
  {
    debater: 'struck',
    timeout: 'ran out of time; Daisy struck',
    automatic: 'struck',
  };

/** How the resolution was chosen, once the Round has ended (ADR 0076). */
function DrawAudit({
  audit,
  sides,
}: {
  readonly audit: NonNullable<RoundView['resolutionAudit']>;
  readonly sides: RoundReceiptView['rules']['sides'];
}) {
  // A spectator of a host list reads whose line it was; an erased one reads as removed.
  const text = (position: number) =>
    audit.items.find((item) => item.position === position)?.text ??
    (audit.textsWithheld
      ? 'A line from the host’s list'
      : 'A removed resolution');
  return (
    <section
      aria-labelledby="receipt-draw"
      className="rounded-xl bg-surface p-6 shadow-1"
    >
      <h2 id="receipt-draw" className="font-strong">
        How the resolution was chosen
      </h2>
      <ol className="text-sm">
        {audit.strikes.map((strike) => (
          <li key={strike.ordinal}>
            {sideName(sides, strike.side)} {strikeWho[strike.kind]} “
            {text(strike.position)}”
          </li>
        ))}
      </ol>
    </section>
  );
}
