import type {
  StageSeatView,
  StageSnapshot,
} from '../../features/stage-capture/stage-access';
import { formatCountdown } from '../../lib/clock-display';
import { DaisyMark } from '../components/daisy-mark/daisy-mark';

type Waiting = Exclude<StageSnapshot, { readonly phase: 'speech' }>;

type SlateFacts = {
  readonly headline: string;
  readonly remainingMs: number | null;
  readonly next: string | null;
  readonly mark: boolean;
};

const slateFacts = (snapshot: Waiting): SlateFacts => {
  const none = { remainingMs: null, next: null, mark: false };
  switch (snapshot.phase) {
    case 'prep':
      return {
        ...none,
        headline: 'Preparation',
        remainingMs: snapshot.remainingMs,
      };
    case 'between':
      return {
        ...none,
        headline: 'Next speech soon',
        remainingMs: snapshot.remainingMs,
        next: snapshot.next.label,
      };
    case 'judging':
      return { ...none, headline: 'Judges are deciding' };
    case 'slate':
      return { ...none, headline: 'Starting soon', mark: true };
    case 'ended':
      return { ...none, headline: 'This debate has ended', mark: true };
  }
};

const namesOf = (
  seats: readonly StageSeatView[],
  side: StageSeatView['side'],
) =>
  seats
    .filter((seat) => seat.side === side)
    .map((seat) => seat.label)
    .join(' · ');

/**
 * The frame outside a speech: what the Round is waiting for, how long while that
 * wait is counting down, and who is debating. Appearance only; the observer's revocation is what
 * keeps a private phase private.
 */
export function StageSlate({ snapshot }: { readonly snapshot: Waiting }) {
  const facts = slateFacts(snapshot);
  const sides = (
    [
      ['Affirmative', namesOf(snapshot.seats, 'affirmative')],
      ['Negative', namesOf(snapshot.seats, 'negative')],
    ] as const
  ).filter(([, names]) => names !== '');
  return (
    <section
      className="broadcast-stage-slate"
      data-clock={facts.remainingMs !== null}
    >
      {facts.mark ? <DaisyMark size={112} variant="reverse" /> : null}
      <h1>{facts.headline}</h1>
      {facts.remainingMs === null ? null : (
        <strong>{formatCountdown(facts.remainingMs)}</strong>
      )}
      {facts.next === null ? null : <p>Next: {facts.next}</p>}
      <dl>
        {sides.map(([side, names]) => (
          <div key={side}>
            <dt>{side}</dt>
            <dd>{names}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
